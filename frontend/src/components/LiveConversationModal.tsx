"use client";

/**
 * LiveConversationModal.tsx  ─ Ephemeral Token 方式（セキュア版）
 * ────────────────────────────────────────────────────────────────────────────
 * 概要:
 *   1. バックエンド POST /api/chapters/{id}/live-token
 *      → 認証済みユーザーにのみ、60秒有効な ephemeral token を返す
 *      → 実際の GEMINI_API_KEY はサーバー内に留まり、フロントには渡らない
 *      → システムプロンプト・モデル設定もトークンに埋め込まれる
 *
 *   2. フロントはそのトークンを access_token として
 *      wss://generativelanguage.googleapis.com/.../v1alpha/...?access_token=TOKEN
 *      に直接 WebSocket 接続する
 *
 * 音声フロー:
 *   マイク → ScriptProcessor(PCM 16kHz) → base64 → Gemini Live API
 *   Gemini Live API → base64 PCM(24kHz) → AudioContext → スピーカー
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

// ─── PCM16 → Float32 ──────────────────────────────────────────────────────
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const int16 = new Int16Array(buffer);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

// ─── Float32 → PCM16 ──────────────────────────────────────────────────────
function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

export default function LiveConversationModal({
  isOpen,
  onClose,
  chapterId,
  chapterTitle,
}: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array<ArrayBuffer>[]>([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const entryIdRef = useRef(0);
  const isMutedRef = useRef(false); // ScriptProcessor は closure を参照するので ref で管理

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
    processorRef.current?.disconnect();
    processorRef.current = null;
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

  // ─ セッション開始（Ephemeral Token フロー）───────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("fetching-token");
    setTranscript([]);
    setErrorMsg("");

    try {
      // 1. Supabase アクセストークン取得
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("ログインが必要です。");

      // 2. バックエンドに ephemeral token を要求（実APIキーはここで使われ、フロントには出ない）
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
      const { ws_url, chapter_title: fetchedTitle, phrases, model } = await tokenRes.json();

      // システムプロンプトをフロントで組み立て (APIキーはバックエンドに留まるので安全)
      const phraseList = (phrases as string[]).map((p: string) => `  - ${p}`).join("\n") || "  (none)";
      const systemPrompt = `You are a friendly and encouraging English conversation coach.
The student just completed Chapter: "${fetchedTitle}".
They practiced these phrases:
${phraseList}
Have a natural, casual spoken conversation. Weave in these phrases naturally.
Keep responses SHORT (1-3 sentences). Speak at a clear pace for learners.
Start with a warm greeting.`;

      // 3. マイク起動
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 4. AudioContext (16kHz でマイク入力をリサンプル)
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (isMutedRef.current) return;
        const b64 = arrayBufferToBase64(float32ToPcm16(e.inputBuffer.getChannelData(0)));
        wsRef.current.send(
          JSON.stringify({
            realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } },
          })
        );
      };
      micSource.connect(processor);
      processor.connect(audioCtx.destination);

      // 5. Gemini Live API v1alpha に ephemeral token で接続
      const ws = new WebSocket(ws_url);
      wsRef.current = ws;

      ws.onopen = () => {
        // setup メッセージでモデル設定とシステムプロンプトを送信
        ws.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
          },
        }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);

        if (msg.setupComplete) {
          setStatus("connected");
          return;
        }

        const sc = msg.serverContent;
        if (!sc) return;

        // 音声チャンク
        for (const part of sc.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) enqueueAudio(part.inlineData.data);
        }

        // テキスト転写
        if (sc.inputTranscription?.text) {
          setTranscript((p) => [
            ...p,
            { role: "user", text: sc.inputTranscription.text, id: entryIdRef.current++ },
          ]);
        }
        if (sc.outputTranscription?.text) {
          setTranscript((p) => [
            ...p,
            { role: "model", text: sc.outputTranscription.text, id: entryIdRef.current++ },
          ]);
        }
      };

      ws.onerror = () => {
        setErrorMsg("Gemini Live APIへの接続でエラーが発生しました。");
        setStatus("error");
        cleanup();
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          setErrorMsg(`接続が切断されました (code: ${e.code})`);
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
  }, [chapterId, enqueueAudio, cleanup]);

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

  // ─ ミュート ─────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      mediaStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  // ─ 副作用 ────────────────────────────────────────────────────────────────
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

  const statusLabel = {
    idle: null,
    "fetching-token": "接続の準備中...",
    connecting: "Geminiに接続中...",
    connected: isMuted ? "ミュート中" : "話しかけてください...",
    error: null,
    stopped: "会話が終了しました",
  }[status];

  const isActive = status === "connected";
  const isBusy = status === "fetching-token" || status === "connecting";
  const canStart = status === "idle" || status === "stopped" || status === "error";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 20 }}
            className="relative w-full max-w-lg rounded-3xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)",
              boxShadow: "0 25px 60px rgba(99,102,241,0.4)",
            }}
          >
            {/* Decorative orbs */}
            <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{ background: "radial-gradient(circle, #a78bfa, transparent)" }} />
            <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{ background: "radial-gradient(circle, #818cf8, transparent)" }} />

            {/* Header */}
            <div className="relative px-6 pt-6 pb-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/30 flex items-center justify-center border border-indigo-400/30">
                    <Volume2 className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">音声で実践する</h2>
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

            {/* Body */}
            <div className="relative px-6 py-5 flex flex-col gap-4">

              {/* Visualizer area */}
              <div className="flex items-center justify-center h-24">
                {isActive && isAISpeaking ? (
                  <div className="flex items-end gap-1 h-full">
                    {[...Array(14)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 rounded-full"
                        style={{ background: "linear-gradient(to top, #818cf8, #c4b5fd)" }}
                        animate={{ height: ["6px", `${18 + Math.random() * 32}px`, "6px"] }}
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
                      style={{ background: "rgba(99,102,241,0.2)", border: "2px solid rgba(99,102,241,0.4)" }}
                      animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      {isMuted ? (
                        <MicOff className="w-6 h-6 text-red-400" />
                      ) : (
                        <Mic className="w-6 h-6 text-indigo-300" />
                      )}
                    </motion.div>
                    <span className="text-indigo-300 text-sm">{statusLabel}</span>
                  </div>
                ) : isBusy ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <span className="text-indigo-300 text-sm">{statusLabel}</span>
                  </div>
                ) : status === "error" ? (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <span className="text-red-300 text-sm max-w-xs leading-snug">{errorMsg}</span>
                  </div>
                ) : status === "stopped" ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                      <PhoneOff className="w-5 h-5 text-slate-400" />
                    </div>
                    <span className="text-slate-400 text-sm">{statusLabel}</span>
                  </div>
                ) : (
                  // idle
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-indigo-400/40"
                      style={{ background: "rgba(99,102,241,0.12)" }}
                    >
                      <Mic className="w-8 h-8 text-indigo-400" />
                    </div>
                    <span className="text-indigo-300/60 text-sm">「会話を始める」で英会話をスタート</span>
                  </div>
                )}
              </div>

              {/* Transcript */}
              {transcript.length > 0 && (
                <div
                  className="max-h-48 overflow-y-auto space-y-2 rounded-2xl p-3"
                  style={{ background: "rgba(0,0,0,0.28)" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-indigo-400 text-xs font-medium">会話の記録</span>
                  </div>
                  {transcript.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          entry.role === "user" ? "rounded-br-sm text-white" : "rounded-bl-sm text-indigo-100"
                        }`}
                        style={{
                          background:
                            entry.role === "user" ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)",
                        }}
                      >
                        {entry.text}
                      </div>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}

              {/* Controls */}
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
                      {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={endSession}
                      className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white"
                      style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                    >
                      <PhoneOff className="w-5 h-5" />
                      終了する
                    </motion.button>
                  </>
                )}
              </div>

              {/* Security badge */}
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
