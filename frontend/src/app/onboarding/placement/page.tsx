"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface PlacementQuestion {
  id: number;
  cefr_level: string;
  japanese_text: string;
  grammar_point: string;
  difficulty: number;
  order_index: number;
}

interface PlacementStartResponse {
  session_id: number;
  questions: PlacementQuestion[];
  total_questions: number;
}

interface BandScore {
  cefr_level: string;
  average_score: number;
  question_count: number;
}

interface PlacementResult {
  session_id: number;
  cefr_level: string;
  placement_score: number;
  recommended_chapter_id: number | null;
  band_scores: BandScore[];
}

interface AccountInfo {
  placement_status: string;
  cefr_level: string;
  placement_score: number | null;
}

type Phase = "intro" | "answering" | "evaluating" | "results" | "completed";

function DifficultyDots({ level }: { level: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((item) => (
        <span
          key={item}
          className={`h-1.5 w-1.5 rounded-full ${item <= level ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700"}`}
        />
      ))}
    </div>
  );
}

export default function PlacementPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [answers, setAnswers] = useState<{ question_id: number; user_answer: string }[]>([]);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const getToken = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return null;
    }
    return session.access_token;
  }, []);

  useEffect(() => {
    const loadAccount = async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load account");
        const data: AccountInfo = await res.json();
        setAccount(data);
        if (data.placement_status === "completed") {
          setPhase("completed");
        }
      } catch (err) {
        console.error(err);
        setError("アカウント情報を読み込めませんでした。");
      } finally {
        setLoadingAccount(false);
      }
    };
    loadAccount();
  }, [getToken]);

  useEffect(() => {
    if (phase === "answering") {
      const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(timeoutId);
    }
  }, [phase, currentIndex]);

  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return Math.round((currentIndex / questions.length) * 100);
  }, [currentIndex, questions.length]);

  const startPlacement = async () => {
    setError(null);
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/placement/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to start placement");
      const data: PlacementStartResponse = await res.json();
      setSessionId(data.session_id);
      setQuestions(data.questions);
      setCurrentIndex(0);
      setAnswers([]);
      setCurrentAnswer("");
      setPhase("answering");
    } catch (err) {
      console.error(err);
      setError("判定テストを開始できませんでした。");
    }
  };

  const submitPlacement = async (finalAnswers: { question_id: number; user_answer: string }[]) => {
    if (!sessionId) return;
    setPhase("evaluating");
    setError(null);
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/placement/${sessionId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      if (!res.ok) throw new Error("Failed to complete placement");
      const data: PlacementResult = await res.json();
      setResult(data);
      setPhase("results");
    } catch (err) {
      console.error(err);
      setError("採点できませんでした。少し時間をおいて再度お試しください。");
      setPhase("answering");
    }
  };

  const submitAnswer = () => {
    const question = questions[currentIndex];
    if (!question || !currentAnswer.trim()) return;

    const nextAnswers = [...answers, { question_id: question.id, user_answer: currentAnswer.trim() }];
    setAnswers(nextAnswers);
    setCurrentAnswer("");

    const nextIndex = currentIndex + 1;
    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex);
      return;
    }
    submitPlacement(nextAnswers);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitAnswer();
    }
  };

  if (loadingAccount) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </main>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 px-4 py-8 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col justify-center">
        <AnimatePresence mode="wait">
          {phase === "intro" && (
            <motion.section
              key="intro"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              className="glass-panel rounded-2xl p-6 sm:p-8"
            >
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                  <Target size={24} />
                </div>
                <div>
                  <p className="text-sm font-bold text-indigo-500">CEFR Placement</p>
                  <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">最初に英語力を判定します</h1>
                </div>
              </div>
              <div className="space-y-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <p>短い日本語フレーズを英語にする12問のテストです。回答後、A1からC2までのCEFRレベルを判定します。</p>
                <p>この結果に合わせて、最初に取り組む章とレッスンの難易度を調整します。</p>
              </div>
              {error && <p className="mt-4 text-sm text-rose-500">{error}</p>}
              <button
                onClick={startPlacement}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500 sm:w-auto"
              >
                テストを始める
                <ArrowRight size={18} />
              </button>
            </motion.section>
          )}

          {phase === "answering" && currentQuestion && (
            <motion.section
              key={`question-${currentQuestion.id}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="space-y-5"
            >
              <div>
                <div className="mb-2 flex justify-between text-xs text-slate-400">
                  <span>{currentIndex + 1} / {questions.length} 問</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                  />
                </div>
              </div>

              <div className="glass-panel rounded-2xl p-6 sm:p-8">
                <div className="mb-4 flex items-center gap-3">
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                    {currentQuestion.grammar_point}
                  </span>
                  <DifficultyDots level={currentQuestion.difficulty} />
                </div>
                <h2 className="text-2xl font-bold leading-relaxed text-slate-800 dark:text-white">
                  {currentQuestion.japanese_text}
                </h2>
              </div>

              <div className="glass-panel rounded-2xl p-5 sm:p-6">
                <textarea
                  ref={inputRef}
                  value={currentAnswer}
                  onChange={(event) => setCurrentAnswer(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="英語で入力してください..."
                  className="min-h-[120px] w-full resize-none bg-transparent text-lg text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
                />
                {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
                <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="hidden text-xs text-slate-400 sm:block">Enterで次へ進みます</span>
                  <button
                    onClick={submitAnswer}
                    disabled={!currentAnswer.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={18} />
                    {currentIndex + 1 === questions.length ? "採点する" : "次へ"}
                  </button>
                </div>
              </div>
            </motion.section>
          )}

          {phase === "evaluating" && (
            <motion.section
              key="evaluating"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-panel rounded-2xl p-10 text-center"
            >
              <Brain className="mx-auto mb-5 h-14 w-14 animate-bounce text-indigo-500" />
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">AIがレベルを判定中...</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">意味の伝わり方と自然さを見ています。</p>
            </motion.section>
          )}

          {phase === "results" && result && (
            <motion.section
              key="results"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel rounded-2xl p-6 sm:p-8"
            >
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-500">Placement Complete</p>
                  <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">あなたのCEFRは {result.cefr_level}</h1>
                </div>
              </div>
              <div className="rounded-2xl bg-white/60 p-5 dark:bg-slate-900/30">
                <p className="text-sm text-slate-400">総合判定スコア</p>
                <p className="mt-1 text-4xl font-extrabold text-indigo-500">{result.placement_score.toFixed(0)}</p>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {result.band_scores.map((band) => (
                  <div key={band.cefr_level} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{band.cefr_level}</span>
                      <span className="text-sm text-slate-400">{band.average_score.toFixed(0)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, band.average_score)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/">
                <button className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500 sm:w-auto">
                  ダッシュボードへ
                  <ArrowRight size={18} />
                </button>
              </Link>
            </motion.section>
          )}

          {phase === "completed" && account && (
            <motion.section
              key="completed"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel rounded-2xl p-6 text-center sm:p-8"
            >
              <ShieldCheck className="mx-auto mb-5 h-14 w-14 text-emerald-500" />
              <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">レベル判定は完了済みです</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                現在のCEFRは {account.cefr_level}
                {account.placement_score !== null ? `、判定スコアは ${account.placement_score.toFixed(0)} です。` : " です。"}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href="/">
                  <button className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-500">
                    ダッシュボードへ
                    <ArrowRight size={18} />
                  </button>
                </Link>
                <Link href="/account">
                  <button className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    アカウントを見る
                    <Sparkles size={18} />
                  </button>
                </Link>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
