"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
  RefreshCw,
  BookOpen,
  Target,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ChapterInfo {
  id: number;
  number: number;
  title: string;
  cefr_level: string;
  grammar_points: string;
  status: string;
  proficiency_score: number;
  total_attempts: number;
  accuracy_rate: number;
}

function PracticeContent() {
  const searchParams = useSearchParams();
  const chapterId = searchParams.get("chapter");

  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [question, setQuestion] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<any>(null);
  const [sessionStats, setSessionStats] = useState({ total: 0, correct: 0 });

  const supabase = createClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && !feedback && inputRef.current) {
      inputRef.current.focus();
    }
  }, [loading, feedback]);

  // Load chapter info
  useEffect(() => {
    if (!chapterId) return;
    const fetchChapter = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      try {
        const res = await fetch(`${API_URL}/api/chapters/${chapterId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setChapter(data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchChapter();
  }, [chapterId]);

  const loadQuestion = async () => {
    if (!chapterId) return;
    setLoading(true);
    setFeedback(null);
    setAnswer("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${API_URL}/api/questions/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ chapter_id: parseInt(chapterId) }),
      });
      const data = await res.json();
      setQuestion(data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (chapterId) {
      loadQuestion();
    }
  }, [chapterId]);

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setEvaluating(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${API_URL}/api/answers/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          question_id: question.id,
          user_answer: answer,
        }),
      });

      const evalData = await res.json();
      setFeedback(evalData);
      setEvaluating(false);

      // Update session stats
      setSessionStats((prev) => ({
        total: prev.total + 1,
        correct: prev.correct + (evalData.is_correct ? 1 : 0),
      }));

      // Refresh chapter info
      if (chapterId) {
        const chRes = await fetch(`${API_URL}/api/chapters/${chapterId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const chData = await chRes.json();
        setChapter(chData);
      }
    } catch (err) {
      console.error(err);
      setEvaluating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!feedback && !evaluating && answer.trim()) {
        handleSubmit();
      } else if (feedback) {
        loadQuestion();
      }
    }
  };

  if (!chapterId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4">
        <Brain size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
        <h2 className="text-xl font-bold text-slate-600 dark:text-slate-300 mb-2">章が選択されていません</h2>
        <p className="text-slate-400 mb-6">ダッシュボードから練習する章を選んでください。</p>
        <Link href="/">
          <button className="px-6 py-3 bg-indigo-600 text-white rounded-full font-bold hover:bg-indigo-500 transition-colors">
            ダッシュボードへ
          </button>
        </Link>
      </div>
    );
  }

  const sessionAccuracy = sessionStats.total > 0 ? (sessionStats.correct / sessionStats.total) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4 py-8">
      {/* Header */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-4">
        <Link href={`/chapters/${chapterId}`}>
          <button className="flex items-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5 mr-1" /> 章の詳細へ戻る
          </button>
        </Link>
        {sessionStats.total > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400">今回: {sessionStats.correct}/{sessionStats.total}問正解</span>
            <span className={`font-bold ${sessionAccuracy >= 70 ? "text-emerald-500" : "text-orange-500"}`}>
              {sessionAccuracy.toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Chapter Context Bar */}
      {chapter && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-3xl mb-6"
        >
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl">
                  <BookOpen size={20} className="text-indigo-500" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 dark:text-white text-sm">
                    第{chapter.number}章: {chapter.title}
                  </h2>
                  <p className="text-xs text-slate-400">{chapter.cefr_level} • {chapter.grammar_points}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="text-center hidden sm:block">
                  <p className="text-slate-400">スコア</p>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400 text-lg">{chapter.proficiency_score.toFixed(0)}</p>
                </div>
                <div className="text-center hidden sm:block">
                  <p className="text-slate-400">正答率</p>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">{chapter.accuracy_rate.toFixed(0)}%</p>
                </div>
              </div>
            </div>

            {/* Mastery progress bar */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>マスターまで (スコア80 & 10問以上)</span>
                <span>{Math.min(100, chapter.proficiency_score).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  key={chapter.proficiency_score}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (chapter.proficiency_score / 80) * 100)}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={`h-full rounded-full ${
                    chapter.status === "mastered"
                      ? "bg-gradient-to-r from-emerald-400 to-teal-500"
                      : "bg-gradient-to-r from-indigo-400 to-purple-500"
                  }`}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 w-full max-w-3xl flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center justify-center p-8 sm:p-12 glass-panel rounded-3xl text-center"
            >
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full animate-pulse" />
                <Brain className="w-16 h-16 text-indigo-500 animate-bounce" />
              </div>
              <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">AIが問題を生成中...</h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                {chapter ? `「${chapter.title}」のテーマに合わせた問題を作成中` : "現在のレベルに合わせた問題を選んでいます"}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="question"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4 sm:gap-6"
            >
              {/* Question Card */}
              <div className="glass-panel p-6 sm:p-8 rounded-3xl relative overflow-hidden group">
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-32 bg-indigo-500 rounded-r-xl" />
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 dark:bg-indigo-900/50 dark:text-indigo-300 rounded-full">
                    Level {question?.difficulty} • {question?.grammar_point}
                  </span>
                  {chapter && (
                    <span className="inline-block px-3 py-1 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 rounded-full">
                      第{chapter.number}章
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-800 dark:text-white leading-relaxed mb-2">
                  {question?.japanese_text}
                </h2>
              </div>

              {/* Answer Input Area */}
              <div
                className={`p-5 sm:p-6 rounded-3xl transition-all duration-300 ${
                  feedback
                    ? "bg-slate-50 dark:bg-slate-800/50 grayscale opacity-70 pointer-events-none"
                    : "glass-panel shadow-lg focus-within:ring-2 focus-within:ring-indigo-500"
                }`}
              >
                <textarea
                  ref={inputRef}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your English translation here..."
                  className="w-full bg-transparent text-lg text-slate-800 dark:text-white placeholder:text-slate-400 outline-none resize-none min-h-[100px]"
                  disabled={!!feedback || evaluating}
                />

                <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-stretch sm:items-center mt-4 gap-3 sm:gap-0">
                  <span className="text-xs text-slate-400 text-center sm:text-left hidden sm:block">
                    <kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-md">Enter</kbd> で送信
                  </span>

                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim() || evaluating || !!feedback}
                    className="flex justify-center items-center px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-full font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all sm:hover:scale-105 active:scale-95"
                  >
                    {evaluating ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        AI 添削中...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5 mr-2" />
                        解答する
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Feedback Area */}
              <AnimatePresence>
                {feedback && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={`mt-4 overflow-hidden rounded-3xl p-6 sm:p-8 border ${
                      feedback.is_correct
                        ? "bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-900 dark:text-emerald-100"
                        : "bg-gradient-to-br from-rose-50 to-orange-50 dark:from-rose-900/20 dark:to-orange-900/20 border-rose-200 dark:border-rose-800/50 text-rose-900 dark:text-rose-100"
                    }`}
                  >
                    <div className="flex items-start gap-4 mb-6">
                      <div
                        className={`p-3 rounded-2xl ${feedback.is_correct ? "bg-emerald-500" : "bg-rose-500"} text-white shadow-lg`}
                      >
                        {feedback.is_correct ? <CheckCircle2 size={32} /> : <XCircle size={32} />}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold mb-1">
                          {feedback.is_correct ? "Excellent!" : "Good Try!"}
                        </h3>
                        <p
                          className={`text-xl opacity-90 font-medium ${
                            feedback.is_correct
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-rose-700 dark:text-rose-300"
                          }`}
                        >
                          スコア: {feedback.score} / 100
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/60 dark:bg-black/20 p-5 rounded-2xl mb-6 backdrop-blur-sm">
                      <p className="text-sm uppercase tracking-wider font-bold opacity-60 mb-1">AI 模範解答</p>
                      <p className="text-xl font-medium">{feedback.expected_english}</p>
                    </div>

                    <p className="text-lg leading-relaxed mb-6">{feedback.feedback_text}</p>

                    <button
                      onClick={loadQuestion}
                      className={`w-full py-4 rounded-full font-bold text-lg flex justify-center items-center shadow-md transition-all sm:hover:-translate-y-1 ${
                        feedback.is_correct
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                          : "bg-rose-600 hover:bg-rose-500 text-white"
                      }`}
                    >
                      <RefreshCw className="mr-2" size={20} />
                      次の問題へ
                    </button>
                    <p className="text-center text-xs opacity-60 mt-4 hidden sm:block">
                      <kbd className="px-2 py-1 bg-black/10 rounded-md">Enter</kbd> でも進めます
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function PracticeScreen() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
          <Brain className="w-12 h-12 text-indigo-500 animate-bounce" />
        </div>
      }
    >
      <PracticeContent />
    </Suspense>
  );
}
