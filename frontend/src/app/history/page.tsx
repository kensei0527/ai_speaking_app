"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  GraduationCap,
  History,
  Lightbulb,
  MessageSquare,
  RefreshCw,
  Target,
  XCircle,
  Zap,
  Brain,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LessonHistoryItem {
  lesson_id: number;
  chapter_id: number;
  chapter_number: number;
  chapter_title: string;
  scenario_id: number | null;
  scenario_title: string | null;
  is_review: boolean;
  total_questions: number;
  correct_count: number;
  accuracy_rate: number;
  average_score: number;
  completed_at: string;
}

interface LessonDetailAnswer {
  order_index: number;
  japanese_text: string;
  expected_english: string;
  user_answer: string;
  is_correct: boolean;
  score: number;
  evaluation_level: string;
  feedback_text: string;
  grammar_point: string | null;
  alternative_expressions: string[];
  naturalness_tips: string[];
}

interface LessonDetailResponse extends LessonHistoryItem {
  answers: LessonDetailAnswer[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : score >= 60
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return (
    <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${color}`}>
      {score.toFixed(0)}点
    </span>
  );
}

// ── Sub-component: Lesson Detail Accordion ────────────────────────────────────

function LessonDetailPanel({
  lessonId,
  token,
}: {
  lessonId: number;
  token: string;
}) {
  const [detail, setDetail] = useState<LessonDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/lessons/${lessonId}/detail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("fetch failed");
        setDetail(await res.json());
      } catch {
        // silent – show nothing
      } finally {
        setLoading(false);
      }
    })();
  }, [lessonId, token]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-8 gap-3">
        <Brain className="w-6 h-6 text-indigo-400 animate-bounce" />
        <span className="text-slate-400 text-sm">読み込み中...</span>
      </div>
    );

  if (!detail || detail.answers.length === 0)
    return (
      <p className="text-center text-slate-400 text-sm py-6">
        解答データが見つかりませんでした。
      </p>
    );

  return (
    <div className="space-y-4 pt-2">
      {detail.answers.map((ans, i) => (
        <div
          key={i}
          className={`rounded-2xl border p-4 ${
            ans.is_correct
              ? "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-900/10"
              : "border-rose-200 dark:border-rose-800/60 bg-rose-50/50 dark:bg-rose-900/10"
          }`}
        >
          {/* Q row */}
          <div className="flex items-start gap-3 mb-3">
            <div
              className={`mt-0.5 flex-shrink-0 ${
                ans.is_correct ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {ans.is_correct ? (
                <CheckCircle2 size={18} />
              ) : (
                <XCircle size={18} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                {ans.japanese_text}
              </p>
              {/* User answer */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-400 text-xs">あなたの解答:</span>
                <span
                  className={`font-medium ${
                    ans.is_correct
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  {ans.user_answer || "（未回答）"}
                </span>
              </div>
              {/* Model answer (show always) */}
              <div className="flex flex-wrap items-center gap-2 text-sm mt-1">
                <span className="text-slate-400 text-xs">模範解答:</span>
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  {ans.expected_english}
                </span>
              </div>
            </div>
            <ScoreBadge score={ans.score} />
          </div>

          {/* Grammar point */}
          {ans.grammar_point && (
            <div className="mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mr-2">
                文法ポイント
              </span>
              <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                {ans.grammar_point}
              </span>
            </div>
          )}

          {/* Feedback */}
          {ans.feedback_text && (
            <div className="flex gap-2 mt-2 p-3 bg-white/60 dark:bg-slate-800/60 rounded-xl text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <MessageSquare
                size={14}
                className="text-indigo-400 flex-shrink-0 mt-0.5"
              />
              <span>{ans.feedback_text}</span>
            </div>
          )}

          {/* Alternative expressions */}
          {ans.alternative_expressions.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-bold text-purple-500">
                <Zap size={12} /> 別の表現
              </div>
              <div className="flex flex-wrap gap-2">
                {ans.alternative_expressions.map((expr, j) => (
                  <span
                    key={j}
                    className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 px-2.5 py-1 rounded-full"
                  >
                    {expr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Naturalness tips */}
          {ans.naturalness_tips.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-bold text-amber-500">
                <Lightbulb size={12} /> ネイティブのコツ
              </div>
              <ul className="space-y-1">
                {ans.naturalness_tips.map((tip, j) => (
                  <li
                    key={j}
                    className="text-xs text-amber-800 dark:text-amber-200 flex gap-1.5"
                  >
                    <span className="text-amber-400">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sub-component: Lesson Card ────────────────────────────────────────────────

function LessonCard({
  item,
  token,
}: {
  item: LessonHistoryItem;
  token: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const accuracyColor =
    item.accuracy_rate >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : item.accuracy_rate >= 60
      ? "text-amber-600 dark:text-amber-400"
      : "text-rose-600 dark:text-rose-400";

  return (
    <motion.div
      layout
      className="glass-panel rounded-2xl overflow-hidden"
    >
      {/* Card Header (always visible) */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors"
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
              item.is_review
                ? "bg-purple-100 dark:bg-purple-900/40"
                : "bg-indigo-100 dark:bg-indigo-900/40"
            }`}
          >
            {item.is_review ? (
              <RefreshCw size={18} className="text-purple-500" />
            ) : (
              <BookOpen size={18} className="text-indigo-500" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                第{item.chapter_number}章
              </span>
              {item.is_review && (
                <span className="text-[10px] font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded-full">
                  復習
                </span>
              )}
            </div>
            <p className="font-bold text-slate-800 dark:text-white text-sm leading-tight">
              {item.chapter_title}
            </p>
            {item.scenario_title && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {item.scenario_title}
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden sm:block text-right">
              <p className={`text-lg font-extrabold ${accuracyColor}`}>
                {item.accuracy_rate.toFixed(0)}%
              </p>
              <p className="text-[10px] text-slate-400">正答率</p>
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-lg font-extrabold text-slate-700 dark:text-slate-200">
                {item.average_score.toFixed(0)}
              </p>
              <p className="text-[10px] text-slate-400">Avg</p>
            </div>
            {expanded ? (
              <ChevronUp size={18} className="text-slate-400" />
            ) : (
              <ChevronDown size={18} className="text-slate-400" />
            )}
          </div>
        </div>

        {/* Mobile stats */}
        <div className="flex sm:hidden items-center gap-4 mt-2 pl-13 text-xs text-slate-500">
          <span className={`font-bold ${accuracyColor}`}>
            {item.accuracy_rate.toFixed(0)}% 正答
          </span>
          <span>平均 {item.average_score.toFixed(0)}点</span>
          <span>
            {item.correct_count}/{item.total_questions}問
          </span>
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {formatDate(item.completed_at)}
          </span>
        </div>

        {/* Desktop date */}
        <div className="hidden sm:flex items-center gap-1 mt-1.5 pl-13 text-xs text-slate-400">
          <Clock size={11} />
          <span>{formatDate(item.completed_at)}</span>
          <span className="mx-1 text-slate-200 dark:text-slate-700">·</span>
          <span>
            {item.correct_count}/{item.total_questions}問正解
          </span>
        </div>
      </button>

      {/* Expanded Detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 border-t border-slate-100 dark:border-slate-700/50 pt-4">
              <LessonDetailPanel lessonId={item.lesson_id} token={token} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [history, setHistory] = useState<LessonHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }
    setToken(session.access_token);

    try {
      const res = await fetch(`${API_URL}/api/lessons/history`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setHistory(await res.json());
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">

        {/* Back + Title */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Link href="/">
            <button className="flex items-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors mb-5">
              <ArrowLeft className="w-5 h-5 mr-1" />
              ダッシュボードへ戻る
            </button>
          </Link>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <History className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">
                レッスン履歴
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                過去のレッスンを振り返って復習しよう
              </p>
            </div>
          </div>
        </motion.div>

        {/* Summary strip */}
        {!loading && history.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="grid grid-cols-3 gap-3 mb-6"
          >
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">完了レッスン</p>
              <p className="text-2xl font-extrabold text-indigo-500">
                {history.length}
                <span className="text-sm font-normal text-slate-400 ml-1">回</span>
              </p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">平均正答率</p>
              <p className="text-2xl font-extrabold text-emerald-500">
                {(
                  history.reduce((s, h) => s + h.accuracy_rate, 0) /
                  history.length
                ).toFixed(1)}
                <span className="text-sm font-normal text-slate-400 ml-0.5">%</span>
              </p>
            </div>
            <div className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">平均スコア</p>
              <p className="text-2xl font-extrabold text-purple-500">
                {(
                  history.reduce((s, h) => s + h.average_score, 0) /
                  history.length
                ).toFixed(1)}
                <span className="text-sm font-normal text-slate-400 ml-1">点</span>
              </p>
            </div>
          </motion.div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full animate-pulse" />
              <Brain className="w-14 h-14 text-indigo-500 animate-bounce" />
            </div>
            <p className="text-slate-400 font-medium">履歴を読み込み中...</p>
          </div>
        )}

        {/* Empty */}
        {!loading && history.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-3xl p-12 text-center"
          >
            <GraduationCap className="w-16 h-16 text-indigo-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-2">
              まだレッスン履歴がありません
            </h3>
            <p className="text-sm text-slate-400 mb-6">
              レッスンを完了すると、ここに履歴が表示されます。
            </p>
            <Link href="/">
              <button className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity shadow-md">
                レッスンを始める
              </button>
            </Link>
          </motion.div>
        )}

        {/* History List */}
        {!loading && history.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="space-y-3"
          >
            {history.map((item, i) => (
              <motion.div
                key={item.lesson_id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.04 }}
              >
                <LessonCard item={item} token={token} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </main>
  );
}
