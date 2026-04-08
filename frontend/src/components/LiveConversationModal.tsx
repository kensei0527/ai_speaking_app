"use client";

/**
 * LiveConversationModal.tsx — 習熟度適応型 & UX改善版
 * ──────────────────────────────────────────────────
 * 改善点:
 *   1. ユーザーレベル (Beginner/Intermediate/Advanced) に応じたプロンプト自動生成
 *   2. AI発話開始時にユーザーの未確定テキストを強制コミット（吹き出し分離）
 *   3. デバッグログの整理
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
  const liveAIRef = useRef("");
  const liveUserRef = useRef("");

  // State
  const [status, setStatus] = useState<Status>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [liveAIText, setLiveAIText] = useState("");
  const [liveUserText, setLiveUserText] = useState("");
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [userLevel, setUserLevel] = useState("Beginner");

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // ── User speech bubble commit utility ────────────────────────────────────
  const commitUserSpeech = useCallback(() => {
    const text = liveUserRef.current.trim();
    if (text) {
      setTranscript((p) => [
        ...p,
        { role: "user", text, id: entryIdRef.current++ },
      ]);
      liveUserRef.current = "";
      setLiveUserText("");
    }
  }, []);

  // ── Audio playback queue ────────────────────────────────────────────────
  const playNextChunk = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAISpeaking(false);
      return;
    }

    // AIが話し始めた際に、未確定のユーザー音声があれば強制コミットして吹き出しを分ける
    if (!isPlayingRef.current) {
      commitUserSpeech();
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
  }, [commitUserSpeech]);

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

      // Setup complete
      if (msg.setupComplete) {
        setStatus("connected");
        const initMsg = {
          realtimeInput: {
            text: "(The student is ready. Please begin.)",
          },
        };
        wsRef.current?.send(JSON.stringify(initMsg));
        return;
      }

      const sc = msg.serverContent as Record<string, unknown> | undefined;
      if (!sc) return;

      // Audio チャンク
      const parts =
        ((sc.modelTurn as Record<string, unknown>)?.parts as
          | Array<Record<string, unknown>>
          | undefined) ?? [];
      for (const part of parts) {
        const inlineData = part.inlineData as { data?: string } | undefined;
        if (inlineData?.data) enqueueAudio(inlineData.data);
      }

      // AI transcription
      const outTx = sc.outputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (outTx?.text) {
        liveAIRef.current += outTx.text;
        setLiveAIText(liveAIRef.current);
      }

      // User transcription
      const inTx = sc.inputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (inTx?.text) {
        liveUserRef.current += inTx.text;
        setLiveUserText(liveUserRef.current);
      }

      // Turn complete (AI finished speaking)
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

      // User utterance finished (Gemini detected silence)
      if (inTx?.finished) {
        commitUserSpeech();
      }
    },
    [enqueueAudio, commitUserSpeech]
  );

  // ── Start session ────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("fetching-token");
    setTranscript([]);
    setErrorMsg("");
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
      const data = await tokenRes.json();
      const { token, user_level, cefr_level, model } = data;
      setUserLevel(user_level);

      // --- Level-adaptive System Prompt Generation ---
      let styleGuide = "";
      if (user_level === "Advanced") {
        styleGuide = `
- Speak at a NATURAL, NATIVE speed.
- Use advanced vocabulary and sophisticated sentence structures.
- Challenge the user with complex questions or follow-up arguments.
- Keep responses engaging and slightly longer (3-4 sentences if moving well).`;
      } else if (user_level === "Intermediate") {
        styleGuide = `
- Speak at a MODERATE, natural pace.
- Use common, everyday English but avoids overly complex idioms.
- Encourage the user to expand their answers (ask "Can you tell me more?").
- Keep responses consistent and conversational (2-3 sentences).`;
      } else {
        // Beginner (Default)
        styleGuide = `
- Speak SLOWLY and CLEARLY. Pause after each sentence.
- Use simple, basic vocabulary only.
- Lead the conversation by asking ONE simple question at a time.
- Keep responses very short (1-2 sentences).`;
      }

      const phraseList =
        (data.phrases as string[])?.map((p) => `  - ${p}`).join("\n") || "";
      const systemPrompt = `You are a warm, patient English conversation coach for ${user_level} learners.

Current Chapter: "${data.chapter_title ?? chapterTitle}" (Target: ${cefr_level ?? "A1"})
Key phrases for this session:
${phraseList}

=== STYLE GUIDE for ${user_level} ===
${styleGuide}

=== COMMON RULES ===
1. Naturally weave in the chapter phrases if possible.
2. If the user uses a phrase correctly, give brief praise.
3. If they make a mistake, gently model the correct phrasing in your react (don't explicitly correct).
4. Do NOT use markdown, bullet points, or lists in your speech.
5. ALWAYS ask a question to hand over the turn.
6. Be encouraging and stay in character.
`;

      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

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

      const ws = new WebSocket(`${LIVE_WSS_BASE}?access_token=${token}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          event.data.text().then(handleMessage);
        } else {
          handleMessage(event.data as string);
        }
      };

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
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
      };

      ws.onerror = () => {
        setErrorMsg("接続エラーが発生しました。");
        setStatus("error");
        cleanup();
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          setErrorMsg(`切断されました (code: ${e.code}) ${e.reason || ""}`);
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

  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "User ended");
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
      mediaStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveAIText, liveUserText]);

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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
          style={{
            background: "linear-gradient(175deg, #0d0b21 0%, #151245 100%)",
            boxShadow: "0 0 80px rgba(79,70,229,0.25)",
            maxHeight: "90vh",
          }}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-white/5 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
                  <Volume2 className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg leading-tight">英会話セッション</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-indigo-400/60 text-xs">{chapterTitle}</span>
                    <span className="text-white/20">•</span>
                    <span className="text-indigo-300/60 text-[10px] uppercase tracking-wider font-bold bg-indigo-400/10 px-1.5 py-0.5 rounded border border-indigo-400/20">
                      {userLevel} Mode
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isActive && (
                  <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full uppercase tracking-widest">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                )}
                <button onClick={handleClose} className="text-white/30 hover:text-white transition-colors">✕</button>
              </div>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 min-h-[300px]">
            {transcript.length === 0 && !liveAIText && !liveUserText && (
              <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40 py-20">
                {!isActive && !isBusy && (
                  <>
                    <Mic className="w-12 h-12 text-indigo-300" />
                    <p className="text-indigo-200 text-sm italic">
                      {status === "error" ? "エラーが発生しました" : "「会話を始める」を押してスタート"}
                    </p>
                  </>
                )}
                {isBusy && <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />}
              </div>
            )}

            {transcript.map((entry) => (
              <div key={entry.id} className={`flex items-start gap-3 ${entry.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0 ${
                  entry.role === "user" ? "bg-indigo-500/20 border-indigo-400/30" : "bg-white/5 border-white/10"
                }`}>
                  {entry.role === "user" ? <User className="w-4 h-4 text-indigo-300" /> : <Bot className="w-4 h-4 text-white/50" />}
                </div>
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  entry.role === "user" 
                    ? "bg-indigo-600/60 text-white rounded-tr-none" 
                    : "bg-white/5 text-indigo-50 border border-white/5 rounded-tl-none"
                }`}>
                  {entry.text}
                </div>
              </div>
            ))}

            {liveAIText && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white/50" />
                </div>
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-none bg-white/5 text-indigo-50 border border-white/5 text-sm leading-relaxed relative">
                  {liveAIText}
                  <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }}
                    className="inline-block w-1.5 h-4 bg-indigo-400/50 ml-1 rounded-sm align-middle" />
                </div>
              </div>
            )}

            {liveUserText && (
              <div className="flex items-start gap-3 flex-row-reverse">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-indigo-300" />
                </div>
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-none bg-indigo-600/30 text-white/70 text-sm leading-relaxed border border-indigo-400/10">
                  {liveUserText}
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} className="h-4" />
          </div>

          {/* AI Wave */}
          {isActive && isAISpeaking && (
            <div className="flex items-center justify-center gap-1 py-1 border-t border-white/5 bg-indigo-400/5">
              {[...Array(12)].map((_, i) => (
                <motion.div key={i} className="w-0.5 rounded-full bg-indigo-400/60"
                  animate={{ height: [4, i % 2 === 0 ? 16 : 10, 4] }}
                  transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }} />
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-6 pb-8 pt-4 border-t border-white/5 bg-black/20">
            <div className="flex items-center justify-center gap-4">
              {canStart ? (
                <button onClick={startSession}
                  className="flex items-center gap-2 px-10 py-4 rounded-full font-bold text-white transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(79,70,229,0.4)]"
                  style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
                  <Mic className="w-5 h-5" />
                  {status === "error" ? "再接続" : "会話を始める"}
                </button>
              ) : isBusy ? (
                <button disabled className="px-10 py-4 rounded-full font-bold text-white/30 bg-white/5 flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> 準備中...
                </button>
              ) : (
                <>
                  <button onClick={toggleMute}
                    className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all ${
                      isMuted ? "bg-red-500/20 border-red-500/50 text-red-400" : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                    }`}>
                    {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  <button onClick={endSession}
                    className="flex items-center gap-2 px-8 py-4 rounded-full font-bold text-white bg-red-600 hover:bg-red-700 transition-all shadow-lg active:scale-95">
                    <PhoneOff className="w-5 h-5" /> 終了
                  </button>
                </>
              )}
            </div>
            {isActive && !isMuted && (
              <p className="text-center text-indigo-400/40 text-[10px] mt-4 uppercase tracking-[0.2em] font-medium">
                AI is listening...
              </p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
