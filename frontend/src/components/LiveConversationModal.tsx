"use client";

/**
 * LiveConversationModal.tsx — Ephemeral Token + AudioWorklet 版
 * ────────────────────────────────────────────────────────────────────────────
 * フロー:
 *   1. POST /api/chapters/{id}/live-token → ephemeral token 取得
 *   2. wss://.../BidiGenerateContentConstrained?access_token=TOKEN に接続
 *   3. onopen で setup メッセージ送信
 *   4. AudioWorkletNode でマイク → PCM16 → base64 → Gemini
 *   5. Gemini → base64 PCM24kHz → AudioContext → スピーカー
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import {
  Mic,
  MicOff,
  PhoneOff,
  MessageSquare,
  Volume2,
  Waves,
  AlertCircle,
  Loader2,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Gemini Live API — ephemeral token は access_token= で v1alpha の Constrained エンドポイントに渡す
const LIVE_WSS_BASE =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

// ─── AudioWorklet processor のインライン定義 ───────────────────────────────
// ScriptProcessorNode は deprecated なので AudioWorkletNode を使う
const WORKLET_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const float32 = input[0];
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
`;

// ─── ユーティリティ ──────────────────────────────────────────────────────
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const int16 = new Int16Array(buffer);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // チャンク処理でスタックオーバーフロー防止
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

interface TranscriptEntry {
  role: "user" | "model";
  text: string;
  id: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  chapterId: number;
  chapterTitle: string;
}

type ConnectionStatus =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "connected"
  | "error"
  | "stopped";

export default function LiveConversationModal({
  isOpen,
  onClose,
  chapterId,
  chapterTitle,
}: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Float32Array<ArrayBuffer>[]>([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const entryIdRef = useRef(0);
  const isMutedRef = useRef(false);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isAISpeaking, setIsAISpeaking] = useState(false);

  // ─ キュー再生 ────────────────────────────────────────────────────────────
  const playNextChunk = useCallback(() => {
    if (!audioCtxRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAISpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAISpeaking(true);
    const samples = audioQueueRef.current.shift()!;
    const buf = audioCtxRef.current.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src = audioCtxRef.current.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtxRef.current.destination);
    src.onended = playNextChunk;
    src.start();
  }, []);

  const enqueueAudio = useCallback(
    (base64: string) => {
      const f32 = pcm16ToFloat32(base64ToArrayBuffer(base64));
      audioQueueRef.current.push(f32);
      if (!isPlayingRef.current) playNextChunk();
    },
    [playNextChunk]
  );

  // ─ クリーンアップ ────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAISpeaking(false);
  }, []);

  // ─ セッション開始 ────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("fetching-token");
    setTranscript([]);
    setErrorMsg("");

    try {
      // 1. Supabase セッション取得
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("ログインが必要です。");

      // 2. バックエンドから ephemeral token 取得（APIキーはバックエンドに留まる）
      const tokenRes = await fetch(
        `${API_URL}/api/chapters/${chapterId}/live-token`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.detail || `トークン取得失敗 (${tokenRes.status})`);
      }
      const { token, chapter_title: fetchedTitle, phrases, model } = await tokenRes.json();

      // 3. システムプロンプト構築
      const phraseList =
        (phrases as string[]).map((p: string) => `  - ${p}`).join("\n") ||
        "  (none)";
      const systemPrompt = `You are a friendly and encouraging English conversation coach.
The student just completed Chapter: "${fetchedTitle ?? chapterTitle}".
They practiced these English phrases:
${phraseList}
Your mission: Have a natural, casual spoken conversation (1-3 sentences max per turn).
Naturally weave in opportunities to use the phrases above.
Gently correct mistakes. Speak clearly for English learners.
Start with a warm greeting related to the chapter topic.`;

      // 4. マイク起動
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 5. AudioContext — 出力は 24kHz、入力処理用に 16kHz にリサンプル
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      // AudioWorklet (PCM16Processor) を Blob URL でロード
      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const micSource = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "pcm16-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (isMutedRef.current) return;
        const b64 = arrayBufferToBase64(e.data);
        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: b64, mimeType: "audio/pcm" },
            },
          })
        );
      };

      micSource.connect(workletNode);
      // ※ workletNode は出力先不要（postMessage で転送するだけ）

      // 6. Gemini Live API v1alpha Constrained エンドポイントに ephemeral token で接続
      const wsUrl = `${LIVE_WSS_BASE}?access_token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // setup メッセージ送信
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Aoede" },
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: systemPrompt }],
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
      };

      ws.onmessage = (event) => {
        let raw: string;
        if (event.data instanceof Blob) {
          // Blob の場合は読み替え（非同期）
          event.data.text().then((text) => {
            handleMessage(text);
          });
          return;
        }
        raw = event.data as string;
        handleMessage(raw);
      };

      const handleMessage = (raw: string) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        if (msg.setupComplete) {
          setStatus("connected");
          return;
        }

        const sc = msg.serverContent as Record<string, unknown> | undefined;
        if (!sc) return;

        const parts = (sc.modelTurn as Record<string, unknown>)?.parts as
          | Array<Record<string, unknown>>
          | undefined;
        for (const part of parts ?? []) {
          const inlineData = part.inlineData as
            | Record<string, string>
            | undefined;
          if (inlineData?.data) enqueueAudio(inlineData.data);
        }

        const inputTx = sc.inputTranscription as
          | Record<string, string>
          | undefined;
        if (inputTx?.text) {
          setTranscript((p) => [
            ...p,
            { role: "user", text: inputTx.text, id: entryIdRef.current++ },
          ]);
        }
        const outputTx = sc.outputTranscription as
          | Record<string, string>
          | undefined;
        if (outputTx?.text) {
          setTranscript((p) => [
            ...p,
            { role: "model", text: outputTx.text, id: entryIdRef.current++ },
          ]);
        }
      };

      ws.onerror = () => {
        setErrorMsg("Gemini Live API との接続でエラーが発生しました。");
        setStatus("error");
        cleanup();
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          setErrorMsg(
            `接続が切断されました (code: ${e.code})` +
              (e.reason ? ` — ${e.reason}` : "")
          );
          setStatus("error");
        } else {
          setStatus("stopped");
        }
        cleanup();
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
      setStatus("error");
      cleanup();
    }
  }, [chapterId, chapterTitle, enqueueAudio, cleanup]);

  // ─ セッション終了 ────────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "User ended session");
    } else {
      cleanup();
    }
    setStatus("stopped");
  }, [cleanup]);

  const handleClose = useCallback(() => {
    endSession();
    onClose();
  }, [endSession, onClose]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      mediaStreamRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setStatus("idle");
      setTranscript([]);
      setErrorMsg("");
      setIsMuted(false);
      isMutedRef.current = false;
    }
  }, [isOpen, cleanup]);

  if (!isOpen) return null;

  const isBusy = status === "fetching-token" || status === "connecting";
  const isActive = status === "connected";
  const canStart = status === "idle" || status === "stopped" || status === "error";

  const busyLabel =
    status === "fetching-token" ? "接続の準備中..." : "Geminiに接続中...";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            backgroundColor: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
          }}
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 20 }}
            className="relative w-full max-w-lg rounded-3xl overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)",
              boxShadow: "0 25px 60px rgba(99,102,241,0.4)",
            }}
          >
            {/* 装飾 */}
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{
                background: "radial-gradient(circle, #a78bfa, transparent)",
              }}
            />
            <div
              className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{
                background: "radial-gradient(circle, #818cf8, transparent)",
              }}
            />

            {/* ヘッダー */}
            <div className="relative px-6 pt-6 pb-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/30 flex items-center justify-center border border-indigo-400/30">
                    <Volume2 className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">
                      音声で実践する
                    </h2>
                    <p className="text-indigo-300/70 text-xs">{chapterTitle}</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
                  aria-label="閉じる"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* ボディ */}
            <div className="relative px-6 py-5 flex flex-col gap-4">
              {/* ビジュアライザー */}
              <div className="flex items-center justify-center h-24">
                {isActive && isAISpeaking ? (
                  <div className="flex items-end gap-1 h-full">
                    {[...Array(14)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 rounded-full"
                        style={{
                          background:
                            "linear-gradient(to top, #818cf8, #c4b5fd)",
                        }}
                        animate={{
                          height: [
                            "6px",
                            `${18 + Math.random() * 32}px`,
                            "6px",
                          ],
                        }}
                        transition={{
                          duration: 0.4 + Math.random() * 0.5,
                          repeat: Infinity,
                          delay: i * 0.04,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                ) : isActive ? (
                  <div className="flex flex-col items-center gap-2">
                    <motion.div
                      className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{
                        background: "rgba(99,102,241,0.2)",
                        border: "2px solid rgba(99,102,241,0.4)",
                      }}
                      animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      {isMuted ? (
                        <MicOff className="w-6 h-6 text-red-400" />
                      ) : (
                        <Mic className="w-6 h-6 text-indigo-300" />
                      )}
                    </motion.div>
                    <span className="text-indigo-300 text-sm">
                      {isMuted ? "ミュート中" : "話しかけてください..."}
                    </span>
                  </div>
                ) : isBusy ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <span className="text-indigo-300 text-sm">{busyLabel}</span>
                  </div>
                ) : status === "error" ? (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <span className="text-red-300 text-sm max-w-xs leading-snug">
                      {errorMsg}
                    </span>
                  </div>
                ) : status === "stopped" ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                      <PhoneOff className="w-5 h-5 text-slate-400" />
                    </div>
                    <span className="text-slate-400 text-sm">
                      会話が終了しました
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-indigo-400/40"
                      style={{ background: "rgba(99,102,241,0.12)" }}
                    >
                      <Mic className="w-8 h-8 text-indigo-400" />
                    </div>
                    <span className="text-indigo-300/60 text-sm">
                      「会話を始める」でスタート
                    </span>
                  </div>
                )}
              </div>

              {/* トランスクリプト */}
              {transcript.length > 0 && (
                <div
                  className="max-h-48 overflow-y-auto space-y-2 rounded-2xl p-3"
                  style={{ background: "rgba(0,0,0,0.28)" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-indigo-400 text-xs font-medium">
                      会話の記録
                    </span>
                  </div>
                  {transcript.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex ${
                        entry.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          entry.role === "user"
                            ? "rounded-br-sm text-white"
                            : "rounded-bl-sm text-indigo-100"
                        }`}
                        style={{
                          background:
                            entry.role === "user"
                              ? "rgba(99,102,241,0.5)"
                              : "rgba(255,255,255,0.08)",
                        }}
                      >
                        {entry.text}
                      </div>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}

              {/* コントロール */}
              <div className="flex items-center justify-center gap-4">
                {canStart ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startSession}
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      boxShadow: "0 0 24px rgba(99,102,241,0.4)",
                    }}
                  >
                    <Mic className="w-5 h-5" />
                    {status === "error" ? "再接続する" : "会話を始める"}
                  </motion.button>
                ) : isBusy ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white/50 bg-white/10 cursor-not-allowed"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    準備中...
                  </button>
                ) : (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleMute}
                      title={isMuted ? "ミュート解除" : "ミュート"}
                      className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                        isMuted
                          ? "bg-red-500/20 border-red-500/50 text-red-400"
                          : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                      }`}
                    >
                      {isMuted ? (
                        <MicOff className="w-5 h-5" />
                      ) : (
                        <Mic className="w-5 h-5" />
                      )}
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={endSession}
                      className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white"
                      style={{
                        background:
                          "linear-gradient(135deg, #ef4444, #dc2626)",
                      }}
                    >
                      <PhoneOff className="w-5 h-5" />
                      終了する
                    </motion.button>
                  </>
                )}
              </div>

              {/* セキュリティバッジ */}
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-center text-indigo-400/50 text-xs">
                  セキュア接続 • この章で学んだフレーズを使って話してみよう
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
