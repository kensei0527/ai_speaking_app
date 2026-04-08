"use client";

/**
 * LiveConversationModal.tsx — 初心者向け設計版
 * ─────────────────────────────────────────────
 * 改善点:
 *   1. AIが先に話し始める（setupComplete後に挨拶をトリガー）
 *   2. 一文ずつリアルタイム字幕表示（ストリーミング→確定）
 *   3. ゆっくり話す設定（システムプロンプト + speakingRate）
 *   4. AudioWorkletNode（ScriptProcessorNode 廃止対応）
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  AlertCircle,
  Loader2,
  Bot,
  User,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const LIVE_WSS_BASE =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

// ── AudioWorklet processor (inline blob) ────────────────────────────────────
const WORKLET_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const int16 = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
`;

// ── Utilities ────────────────────────────────────────────────────────────────
function pcm16ToFloat32(buf: ArrayBuffer): Float32Array<ArrayBuffer> {
  const i16 = new Int16Array(buf);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

// ── Types ────────────────────────────────────────────────────────────────────
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

type Status =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "connected"
  | "error"
  | "stopped";

// ── Component ────────────────────────────────────────────────────────────────
export default function LiveConversationModal({
  isOpen,
  onClose,
  chapterId,
  chapterTitle,
}: Props) {
  // WebSocket / Audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Float32Array<ArrayBuffer>[]>([]);
  const isPlayingRef = useRef(false);
  const isMutedRef = useRef(false);
  const entryIdRef = useRef(0);

  // Live transcription accumulator refs
  const liveAIRef = useRef(""); // streaming AI text (not yet committed)
  const liveUserRef = useRef(""); // streaming user text

  // State
  const [status, setStatus] = useState<Status>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveAIText, setLiveAIText] = useState(""); // current AI sentence streaming
  const [liveUserText, setLiveUserText] = useState(""); // current user utterance
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // ── Audio playback queue ────────────────────────────────────────────────
  const playNextChunk = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAISpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAISpeaking(true);
    const samples = audioQueueRef.current.shift()!;
    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = playNextChunk;
    src.start();
  }, []);

  const enqueueAudio = useCallback(
    (base64: string) => {
      audioQueueRef.current.push(pcm16ToFloat32(base64ToArrayBuffer(base64)));
      if (!isPlayingRef.current) playNextChunk();
    },
    [playNextChunk]
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    const ws = wsRef.current;
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      wsRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    liveAIRef.current = "";
    liveUserRef.current = "";
    setIsAISpeaking(false);
    setLiveAIText("");
    setLiveUserText("");
  }, []);

  // ── Message handler ─────────────────────────────────────────────────────
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Setup complete → AIから話し始めさせるトリガーを送る
      if (msg.setupComplete) {
        setStatus("connected");
        // ユーザーの代わりに最初の一言をシミュレートしてAIに話させる
        wsRef.current?.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: "(The student is ready. Please begin.)" }],
                },
              ],
              turnComplete: true,
            },
          })
        );
        return;
      }

      const sc = msg.serverContent as Record<string, unknown> | undefined;
      if (!sc) return;

      // 音声データ
      const parts = (
        (sc.modelTurn as Record<string, unknown>)?.parts as
          | Array<Record<string, unknown>>
          | undefined
      ) ?? [];
      for (const part of parts) {
        const inlineData = part.inlineData as
          | { data?: string }
          | undefined;
        if (inlineData?.data) enqueueAudio(inlineData.data);
      }

      // AI の転写テキスト（ストリーミング）
      const outTx = sc.outputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (outTx?.text) {
        liveAIRef.current += outTx.text;
        setLiveAIText(liveAIRef.current);
      }

      // ユーザーの転写テキスト（ストリーミング）
      const inTx = sc.inputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (inTx?.text) {
        liveUserRef.current += inTx.text;
        setLiveUserText(liveUserRef.current);
      }

      // ターン完了 → ライブテキストを確定してトランスクリプトに移す
      if (sc.turnComplete) {
        const aiText = liveAIRef.current.trim();
        if (aiText) {
          setTranscript((p) => [
            ...p,
            { role: "model", text: aiText, id: entryIdRef.current++ },
          ]);
        }
        liveAIRef.current = "";
        setLiveAIText("");
      }

      // inputTranscription の finished でユーザー発言確定
      if (inTx?.finished) {
        const userText = liveUserRef.current.trim();
        if (userText) {
          setTranscript((p) => [
            ...p,
            { role: "user", text: userText, id: entryIdRef.current++ },
          ]);
        }
        liveUserRef.current = "";
        setLiveUserText("");
      }
    },
    [enqueueAudio]
  );

  // ── Start session ────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("fetching-token");
    setTranscript([]);
    setErrorMsg("");
    liveAIRef.current = "";
    liveUserRef.current = "";
    setLiveAIText("");
    setLiveUserText("");

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("ログインが必要です。");

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
      const {
        token,
        chapter_title: fetchedTitle,
        phrases,
        model,
      } = await tokenRes.json();

      // システムプロンプト（バックエンドと同じ構造をフロントでも構築）
      const phraseList =
        (phrases as string[]).map((p: string) => `  - ${p}`).join("\n") ||
        "  (none)";
      const systemPrompt = `You are a warm, patient English conversation coach for beginners.

The student just finished Chapter: "${fetchedTitle ?? chapterTitle}".
They practiced these phrases:
${phraseList}

=== SPEAKING STYLE (VERY IMPORTANT) ===
- Speak SLOWLY and CLEARLY. Pause briefly between each sentence.
- Use SIMPLE vocabulary. Avoid idioms or complex grammar.
- Keep EVERY response to ONE or TWO short sentences maximum.
- After each response, always ask ONE simple question to keep the conversation going.
  (The student should never need to initiate — you lead the conversation.)

=== CONVERSATION FLOW ===
1. Start with a warm, simple greeting and one easy question about "${fetchedTitle ?? chapterTitle}".
2. React warmly to the student's answer (1 sentence), then ask the next question.
3. Naturally encourage use of the chapter phrases by asking questions that lead to them.
4. If the student uses a phrase correctly, say "Great!" or "Perfect!" then continue.
5. If they make a grammar mistake, gently model the correct version in your reply — never point out the error directly.

=== IMPORTANT ===
- This is SPOKEN audio. Never use bullet points, markdown, or lists.
- One idea per sentence. Short pauses feel natural in spoken conversation.
- You are guiding a shy beginner — be encouraging, never critical.`;

      // マイク起動
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // AudioContext (16kHz) + AudioWorkletNode
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const micSrc = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm16-processor");
      workletNodeRef.current = worklet;

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (isMutedRef.current) return;
        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: arrayBufferToBase64(e.data), mimeType: "audio/pcm" },
            },
          })
        );
      };
      micSrc.connect(worklet);

      // WebSocket 接続
      const ws = new WebSocket(
        `${LIVE_WSS_BASE}?access_token=${token}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
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
              systemInstruction: { parts: [{ text: systemPrompt }] },
              // 転写を両方有効化
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
      };

      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          event.data.text().then(handleMessage);
        } else {
          handleMessage(event.data as string);
        }
      };

      ws.onerror = () => {
        setErrorMsg("接続エラーが発生しました。");
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
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      cleanup();
    }
  }, [chapterId, chapterTitle, enqueueAudio, cleanup, handleMessage]);

  // ── End session ──────────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "User ended session");
    } else {
      cleanup();
      setStatus("stopped");
    }
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

  // Scroll to bottom on new transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveAIText, liveUserText]);

  // Reset on close
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
  const canStart =
    status === "idle" || status === "stopped" || status === "error";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 260 }}
            className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: "linear-gradient(160deg, #0f0c29 0%, #1a1760 50%, #0f0c29 100%)",
              boxShadow: "0 0 60px rgba(99,102,241,0.35)",
              maxHeight: "92vh",
            }}
          >
            {/* Decorative blobs */}
            <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-15 blur-3xl"
              style={{ background: "radial-gradient(circle, #a78bfa, transparent)" }} />
            <div className="pointer-events-none absolute -bottom-16 -left-16 w-48 h-48 rounded-full opacity-15 blur-3xl"
              style={{ background: "radial-gradient(circle, #6366f1, transparent)" }} />

            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/25 border border-indigo-400/30 flex items-center justify-center">
                    <Volume2 className="w-4 h-4 text-indigo-300" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-base leading-tight">音声で実践</h2>
                    <p className="text-indigo-400/60 text-xs mt-0.5">{chapterTitle}</p>
                  </div>
                </div>
                {/* Status pill */}
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      接続中
                    </span>
                  )}
                  <button
                    onClick={handleClose}
                    className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/50 hover:text-white transition-all text-sm"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* Transcript area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0"
              style={{ minHeight: 200 }}>
              {/* Initial hint when idle */}
              {transcript.length === 0 && !liveAIText && !liveUserText && (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                  {isActive ? (
                    <>
                      <motion.div
                        className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-indigo-400/40"
                        style={{ background: "rgba(99,102,241,0.12)" }}
                        animate={{ scale: [1, 1.07, 1], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2.5, repeat: Infinity }}
                      >
                        <Bot className="w-8 h-8 text-indigo-300" />
                      </motion.div>
                      <p className="text-indigo-300/70 text-sm text-center">
                        AIが話し始めます…<br/>
                        <span className="text-indigo-400/50 text-xs">字幕がここに表示されます</span>
                      </p>
                    </>
                  ) : isBusy ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-9 h-9 text-indigo-400 animate-spin" />
                      <p className="text-indigo-300/70 text-sm">
                        {status === "fetching-token" ? "接続の準備中…" : "Geminiに接続中…"}
                      </p>
                    </div>
                  ) : status === "error" ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <AlertCircle className="w-8 h-8 text-red-400" />
                      <p className="text-red-300 text-sm max-w-xs">{errorMsg}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-indigo-400/30"
                        style={{ background: "rgba(99,102,241,0.08)" }}>
                        <Mic className="w-7 h-7 text-indigo-400/60" />
                      </div>
                      <p className="text-indigo-400/50 text-sm text-center">
                        {status === "stopped" ? "会話が終了しました" : "「会話を始める」を押すとAIが話しかけます"}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Committed transcript */}
              {transcript.map((entry) => (
                <div key={entry.id} className={`flex items-start gap-2 ${entry.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${
                    entry.role === "user"
                      ? "bg-indigo-500/25 border-indigo-400/30"
                      : "bg-violet-500/25 border-violet-400/30"
                  }`}>
                    {entry.role === "user"
                      ? <User className="w-3.5 h-3.5 text-indigo-300" />
                      : <Bot className="w-3.5 h-3.5 text-violet-300" />}
                  </div>
                  {/* Bubble */}
                  <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    entry.role === "user"
                      ? "rounded-tr-sm text-white"
                      : "rounded-tl-sm text-indigo-50"
                  }`}
                    style={{
                      background: entry.role === "user"
                        ? "rgba(99,102,241,0.45)"
                        : "rgba(255,255,255,0.08)",
                    }}>
                    {entry.text}
                  </div>
                </div>
              ))}

              {/* Live AI text (streaming) */}
              {liveAIText && (
                <div className="flex items-start gap-2 flex-row">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-violet-500/25 border-violet-400/30">
                    <Bot className="w-3.5 h-3.5 text-violet-300" />
                  </div>
                  <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-indigo-50"
                    style={{ background: "rgba(255,255,255,0.08)" }}>
                    {liveAIText}
                    <motion.span
                      className="inline-block ml-0.5 w-0.5 h-3.5 bg-indigo-400 align-middle rounded"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  </div>
                </div>
              )}

              {/* Live User text (streaming) */}
              {liveUserText && (
                <div className="flex items-start gap-2 flex-row-reverse">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-indigo-500/25 border-indigo-400/30">
                    <User className="w-3.5 h-3.5 text-indigo-300" />
                  </div>
                  <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed text-white opacity-70"
                    style={{ background: "rgba(99,102,241,0.35)" }}>
                    {liveUserText}
                  </div>
                </div>
              )}

              <div ref={transcriptEndRef} />
            </div>

            {/* AI speaking wave */}
            {isActive && isAISpeaking && (
              <div className="flex-shrink-0 flex items-center justify-center gap-0.5 py-2 border-t border-white/5">
                <span className="text-violet-400/60 text-xs mr-2">AI 話し中</span>
                {[...Array(10)].map((_, i) => (
                  <motion.div key={i} className="w-1 rounded-full bg-violet-400/70"
                    animate={{ height: ["3px", `${8 + Math.random() * 14}px`, "3px"] }}
                    transition={{ duration: 0.4 + Math.random() * 0.4, repeat: Infinity, delay: i * 0.06, ease: "easeInOut" }}
                  />
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex-shrink-0 px-5 pb-6 pt-3 border-t border-white/10">
              <div className="flex items-center justify-center gap-3">
                {canStart ? (
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={startSession}
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white text-sm shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      boxShadow: "0 0 28px rgba(99,102,241,0.45)",
                    }}
                  >
                    <Mic className="w-4 h-4" />
                    {status === "error" ? "再接続する" : "会話を始める"}
                  </motion.button>
                ) : isBusy ? (
                  <button disabled
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white/40 bg-white/8 text-sm cursor-not-allowed">
                    <Loader2 className="w-4 h-4 animate-spin" />準備中…
                  </button>
                ) : (
                  <>
                    {/* Mute */}
                    <motion.button
                      whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={toggleMute}
                      title={isMuted ? "ミュート解除" : "ミュート"}
                      className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
                        isMuted
                          ? "bg-red-500/20 border-red-500/50 text-red-400"
                          : "bg-white/10 border-white/20 text-white/80 hover:bg-white/20"
                      }`}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </motion.button>

                    {/* End */}
                    <motion.button
                      whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                      onClick={endSession}
                      className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white text-sm"
                      style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                    >
                      <PhoneOff className="w-4 h-4" />終了する
                    </motion.button>
                  </>
                )}
              </div>

              {/* Hint text */}
              {isActive && !isMuted && (
                <p className="text-center text-indigo-400/40 text-xs mt-3">
                  AIが質問したら答えてみましょう。ゆっくり話して大丈夫です。
                </p>
              )}
              {isActive && isMuted && (
                <p className="text-center text-red-400/60 text-xs mt-3">
                  マイクがオフです — 上のボタンで解除できます
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
