"use client";

/**
 * LiveConversationModal.tsx
 * ────────────────────────────────────────────────────────────────────────────
 * 章末の「音声で実践する」ボタンから開くリアルタイム音声会話モーダル。
 * 既存の問題・採点フローには一切干渉しない独立したコンポーネント。
 *
 * 音声フロー:
 *   マイク → AudioWorklet(生PCM16kHz) → base64 → WebSocket → バックエンドプロキシ → Gemini Live API
 *   Gemini Live API → バックエンドプロキシ → WebSocket → base64 → PCM24kHz → AudioContext → スピーカー
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
const WS_URL = API_URL.replace(/^http/, "ws"); // http→ws, https→wss

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
  | "connecting"
  | "connected"
  | "error"
  | "stopped";

// ─── PCM16 → Float32 変換ヘルパー ──────────────────────────────────────────
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

// ─── Float32 → PCM16 変換ヘルパー ──────────────────────────────────────────
function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
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
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array<ArrayBuffer>[]>([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const entryIdRef = useRef(0);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isAISpeaking, setIsAISpeaking] = useState(false);

  // ─── オーディオチャンクのキューから順番に再生 ─────────────────────────
  const playNextChunk = useCallback(() => {
    if (!audioCtxRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAISpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAISpeaking(true);
    const samples = audioQueueRef.current.shift()!;
    const buffer = audioCtxRef.current.createBuffer(
      1,
      samples.length,
      24000 // Gemini Live API output is 24kHz
    );
    buffer.copyToChannel(samples, 0);
    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtxRef.current.destination);
    source.onended = playNextChunk;
    source.start();
  }, []);

  // ─── base64 PCM → キューに追加して再生 ────────────────────────────────
  const handleAudioChunk = useCallback(
    (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const float32 = pcm16ToFloat32(bytes.buffer as ArrayBuffer);
      audioQueueRef.current.push(float32);
      if (!isPlayingRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk]
  );

  // ─── クリーンアップ ─────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAISpeaking(false);
  }, []);

  // ─── セッション開始 ─────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("connecting");
    setTranscript([]);
    setErrorMsg("");

    try {
      // 1. Supabase トークン取得
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("ログインが必要です。");
      }

      // 2. マイク起動
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 3. AudioContext (マイク入力: 16kHz リサンプリング用)
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessor でマイクの生 PCM を取得し WebSocket に流す
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (isMuted) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(float32);
        const b64 = btoa(
          String.fromCharCode(...new Uint8Array(pcm16))
        );
        wsRef.current.send(
          JSON.stringify({ type: "audio", data: b64 })
        );
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);

      // 4. WebSocket 接続
      const wsEndpoint = `${WS_URL}/ws/live-conversation/${chapterId}`;
      const ws = new WebSocket(wsEndpoint);
      wsRef.current = ws;

      ws.onopen = () => {
        // 認証メッセージを最初に送る
        ws.send(
          JSON.stringify({ type: "auth", token: session.access_token })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "connected") {
          setStatus("connected");
        } else if (msg.type === "audio") {
          handleAudioChunk(msg.data);
        } else if (msg.type === "transcript") {
          setTranscript((prev) => [
            ...prev,
            {
              role: msg.role,
              text: msg.text,
              id: entryIdRef.current++,
            },
          ]);
        } else if (msg.type === "error") {
          setErrorMsg(msg.message || "エラーが発生しました。");
          setStatus("error");
        } else if (msg.type === "stopped") {
          setStatus("stopped");
        }
      };

      ws.onerror = () => {
        setErrorMsg("接続に失敗しました。バックエンドが起動しているか確認してください。");
        setStatus("error");
      };

      ws.onclose = () => {
        if (status !== "error") setStatus("stopped");
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
      setStatus("error");
      cleanup();
    }
  }, [chapterId, isMuted, handleAudioChunk, cleanup, status]);

  // ─── セッション終了 ─────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
    }
    cleanup();
    setStatus("stopped");
  }, [cleanup]);

  // ─── モーダルを閉じる ───────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    endSession();
    onClose();
  }, [endSession, onClose]);

  // ─── ミュート切り替え ────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (mediaStreamRef.current) {
        mediaStreamRef.current
          .getAudioTracks()
          .forEach((t) => (t.enabled = !next));
      }
      return next;
    });
  }, []);

  // ─── トランスクリプト自動スクロール ─────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ─── モーダルを閉じたときにクリーンアップ ───────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setStatus("idle");
      setTranscript([]);
      setErrorMsg("");
    }
  }, [isOpen, cleanup]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
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
            {/* Animated background orbs */}
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{ background: "radial-gradient(circle, #a78bfa, transparent)" }}
            />
            <div
              className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full opacity-20 blur-3xl"
              style={{ background: "radial-gradient(circle, #818cf8, transparent)" }}
            />

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
              {/* ─ AI Speaking Visualizer ─ */}
              <div className="flex items-center justify-center h-20">
                {status === "connected" && isAISpeaking ? (
                  <div className="flex items-end gap-1 h-full">
                    {[...Array(12)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 rounded-full"
                        style={{ background: "linear-gradient(to top, #818cf8, #c4b5fd)" }}
                        animate={{ height: ["8px", `${20 + Math.random() * 30}px`, "8px"] }}
                        transition={{
                          duration: 0.5 + Math.random() * 0.5,
                          repeat: Infinity,
                          delay: i * 0.05,
                        }}
                      />
                    ))}
                  </div>
                ) : status === "connected" && !isAISpeaking ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Waves className="w-5 h-5 text-indigo-400 animate-pulse" />
                      <span className="text-indigo-300 text-sm">
                        {isMuted ? "ミュート中..." : "聴いています..."}
                      </span>
                    </div>
                  </div>
                ) : status === "connecting" ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <span className="text-indigo-300 text-sm">接続中...</span>
                  </div>
                ) : status === "error" ? (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <span className="text-red-300 text-sm max-w-xs">{errorMsg}</span>
                  </div>
                ) : status === "stopped" ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-slate-400 text-sm">会話が終了しました</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-indigo-400/40"
                      style={{ background: "rgba(99,102,241,0.15)" }}
                    >
                      <Mic className="w-8 h-8 text-indigo-400" />
                    </div>
                    <span className="text-indigo-300/70 text-sm">
                      「会話を始める」で英会話をスタート
                    </span>
                  </div>
                )}
              </div>

              {/* ─ Transcript ─ */}
              {transcript.length > 0 && (
                <div
                  className="max-h-48 overflow-y-auto space-y-2 rounded-2xl p-3"
                  style={{ background: "rgba(0,0,0,0.25)" }}
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
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
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

              {/* ─ Controls ─ */}
              <div className="flex items-center justify-center gap-4">
                {status === "idle" || status === "stopped" || status === "error" ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startSession}
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      boxShadow: "0 0 20px rgba(99,102,241,0.4)",
                    }}
                  >
                    <Mic className="w-5 h-5" />
                    {status === "error" ? "再接続する" : "会話を始める"}
                  </motion.button>
                ) : status === "connecting" ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-white/50 bg-white/10 cursor-not-allowed"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    接続中...
                  </button>
                ) : (
                  <>
                    {/* Mute Button */}
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={toggleMute}
                      className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                        isMuted
                          ? "bg-red-500/20 border-red-500/50 text-red-400"
                          : "bg-white/10 border-white/20 text-white hover:bg-white/20"
                      }`}
                      title={isMuted ? "ミュート解除" : "ミュート"}
                    >
                      {isMuted ? (
                        <MicOff className="w-5 h-5" />
                      ) : (
                        <Mic className="w-5 h-5" />
                      )}
                    </motion.button>

                    {/* End Call Button */}
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

              {/* ─ Disclaimer ─ */}
              <p className="text-center text-indigo-400/40 text-xs">
                AIとの英語会話練習 • この章で学んだフレーズを使って話してみよう
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
