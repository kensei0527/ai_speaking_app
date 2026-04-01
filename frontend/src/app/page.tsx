"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Brain,
  Trophy,
  Activity,
  LogOut,
  Lock,
  Sparkles,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Target,
  TrendingUp,
  Zap,
  BarChart2,
} from "lucide-react";
import { motion } from "framer-motion";
import { createClient } from "@/utils/supabase/client";

interface WeakPoint {
  grammar_point: string;
  attempts: number;
  accuracy: number;
}

interface ChapterProgress {
  id: number;
  number: number;
  title: string;
  description: string;
  grammar_points: string;
  cefr_level: string;
  status: string;
  proficiency_score: number;
  total_attempts: number;
  accuracy_rate: number;
}

interface UserStats {
  overall_level: string;
  overall_score: number;
  chapters_mastered: number;
  total_chapters: number;
  total_attempts: number;
  overall_accuracy: number;
  weak_points: WeakPoint[];
  chapter_progress: ChapterProgress[];
}

const statusConfig: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; bgGradient: string; ringColor: string }
> = {
  locked: {
    icon: <Lock size={20} />,
    label: "ロック中",
    color: "text-slate-400 dark:text-slate-500",
    bgGradient: "from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700",
    ringColor: "ring-slate-300 dark:ring-slate-600",
  },
  available: {
    icon: <Sparkles size={20} />,
    label: "挑戦可能",
    color: "text-amber-600 dark:text-amber-400",
    bgGradient: "from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20",
    ringColor: "ring-amber-300 dark:ring-amber-600",
  },
  in_progress: {
    icon: <BookOpen size={20} />,
    label: "学習中",
    color: "text-indigo-600 dark:text-indigo-400",
    bgGradient: "from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20",
    ringColor: "ring-indigo-400 dark:ring-indigo-500",
  },
  mastered: {
    icon: <CheckCircle2 size={20} />,
    label: "マスター済",
    color: "text-emerald-600 dark:text-emerald-400",
    bgGradient: "from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20",
    ringColor: "ring-emerald-400 dark:ring-emerald-500",
  },
};

const levelConfig: Record<string, { emoji: string; gradient: string; label: string }> = {
  Beginner: { emoji: "🌱", gradient: "from-green-400 to-emerald-500", label: "初級" },
  Intermediate: { emoji: "🔥", gradient: "from-orange-400 to-red-500", label: "中級" },
  Advanced: { emoji: "⚡", gradient: "from-purple-400 to-indigo-600", label: "上級" },
};

export default function Dashboard() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchStats = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${API_URL}/api/users/me/stats`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full animate-pulse" />
            <Brain className="w-16 h-16 text-indigo-500 animate-bounce" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">学習データを読み込み中...</p>
        </motion.div>
      </main>
    );
  }

  if (!stats) return null;

  const level = levelConfig[stats.overall_level] || levelConfig.Beginner;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8 bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl flex justify-between items-center mb-10"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl text-white shadow-lg">
            <Brain size={26} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">
            AI{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">
              瞬間英作文
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/profile">
            <button className="flex items-center gap-2 text-slate-400 hover:text-indigo-500 transition-colors px-3 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
              <BarChart2 size={18} />
              <span className="text-sm font-medium hidden sm:inline">スキルレポート</span>
            </button>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-slate-400 hover:text-red-500 transition-colors px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium hidden sm:inline">ログアウト</span>
          </button>
        </div>
      </motion.div>

      <div className="w-full max-w-5xl space-y-8">
        {/* ── Overall Level Banner ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-panel rounded-3xl p-6 sm:p-8 relative overflow-hidden"
        >
          <div className="absolute -right-8 -top-8 w-40 h-40 bg-gradient-to-br opacity-10 rounded-full blur-2xl" style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }} />
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${level.gradient} flex items-center justify-center text-4xl shadow-lg`}>
                {level.emoji}
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                  あなたの総合レベル
                </p>
                <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white">
                  {level.label}{" "}
                  <span className="text-lg font-medium text-slate-400">({stats.overall_level})</span>
                </h2>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  {stats.chapters_mastered}章マスター・スコア{stats.overall_score.toFixed(0)}に基づく判定
                </p>
              </div>
            </div>
            <div className="flex gap-4 sm:gap-6 flex-wrap">
              <div className="text-center">
                <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">総合スコア</p>
                <p className={`text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br ${level.gradient}`}>
                  {stats.overall_score.toFixed(1)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">マスター</p>
                <p className="text-3xl font-extrabold text-indigo-500">
                  {stats.chapters_mastered}
                  <span className="text-base font-medium text-slate-400">/{stats.total_chapters}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-6">
            <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mb-2">
              <span>全体進捗</span>
              <span>{Math.round((stats.chapters_mastered / stats.total_chapters) * 100)}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(stats.chapters_mastered / stats.total_chapters) * 100}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
                className={`h-full bg-gradient-to-r ${level.gradient} rounded-full`}
              />
            </div>
          </div>
        </motion.div>

        {/* ── Stats Row ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel p-5 rounded-2xl flex items-center gap-4"
          >
            <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-xl">
              <Activity size={24} className="text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500">総学習回数</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {stats.total_attempts}<span className="text-sm font-normal text-slate-400 ml-1">問</span>
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-panel p-5 rounded-2xl flex items-center gap-4"
          >
            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl">
              <Target size={24} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500">正答率</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {stats.overall_accuracy.toFixed(1)}<span className="text-sm font-normal text-slate-400 ml-1">%</span>
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-panel p-5 rounded-2xl flex items-center gap-4"
          >
            <div className="p-3 bg-amber-100 dark:bg-amber-900/40 rounded-xl">
              <Trophy size={24} className="text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-slate-400 dark:text-slate-500">マスター済み</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {stats.chapters_mastered}<span className="text-sm font-normal text-slate-400 ml-1">/ {stats.total_chapters} 章</span>
              </p>
            </div>
          </motion.div>
        </div>

        {/* ── Weak Points ────────────────────────────────────────── */}
        {stats.weak_points.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="glass-panel rounded-2xl p-5 sm:p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-orange-500" />
              <h3 className="font-bold text-slate-700 dark:text-slate-200">苦手ポイント</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              {stats.weak_points.map((wp) => (
                <div
                  key={wp.grammar_point}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/40 rounded-full text-sm"
                >
                  <Zap size={14} className="text-orange-500" />
                  <span className="font-medium text-orange-800 dark:text-orange-300">{wp.grammar_point}</span>
                  <span className="text-orange-400 text-xs">{wp.accuracy.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Learning Roadmap ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp size={22} className="text-indigo-500" />
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">学習ロードマップ</h3>
          </div>

          <div className="space-y-4">
            {stats.chapter_progress.map((ch, index) => {
              const config = statusConfig[ch.status] || statusConfig.locked;
              const isLocked = ch.status === "locked";

              return (
                <motion.div
                  key={ch.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + index * 0.05 }}
                >
                  {isLocked ? (
                    <div
                      className={`glass-panel rounded-2xl p-4 sm:p-5 opacity-50 cursor-not-allowed border-l-4 border-slate-300 dark:border-slate-600`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${config.bgGradient} flex items-center justify-center ${config.color}`}>
                            {config.icon}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{ch.cefr_level}</span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 ${config.color}`}>
                                {config.label}
                              </span>
                            </div>
                            <h4 className="font-bold text-slate-500 dark:text-slate-400 mt-1">
                              第{ch.number}章: {ch.title}
                            </h4>
                          </div>
                        </div>
                        <Lock size={20} className="text-slate-300 dark:text-slate-600" />
                      </div>
                    </div>
                  ) : (
                    <Link href={`/chapters/${ch.id}`}>
                      <div
                        className={`glass-panel rounded-2xl p-4 sm:p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-l-4 ${
                          ch.status === "mastered"
                            ? "border-emerald-400 dark:border-emerald-500"
                            : ch.status === "in_progress"
                            ? "border-indigo-400 dark:border-indigo-500"
                            : "border-amber-400 dark:border-amber-500"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${config.bgGradient} flex items-center justify-center ${config.color} flex-shrink-0`}>
                              {config.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{ch.cefr_level}</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  ch.status === "mastered"
                                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                                    : ch.status === "in_progress"
                                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                                    : "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                                }`}>
                                  {config.label}
                                </span>
                              </div>
                              <h4 className="font-bold text-slate-800 dark:text-white mt-1">
                                第{ch.number}章: {ch.title}
                              </h4>
                              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 truncate">
                                {ch.grammar_points}
                              </p>
                            </div>
                          </div>

                          {/* Stats + arrow */}
                          <div className="flex items-center gap-5 flex-shrink-0 ml-4">
                            {ch.total_attempts > 0 && (
                              <div className="hidden sm:flex items-center gap-4 text-right">
                                <div>
                                  <p className="text-xs text-slate-400">スコア</p>
                                  <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                    {ch.proficiency_score.toFixed(0)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400">正答率</p>
                                  <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                    {ch.accuracy_rate.toFixed(0)}%
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400">問題数</p>
                                  <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                    {ch.total_attempts}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Progress ring */}
                            <div className="relative w-12 h-12 hidden sm:flex items-center justify-center">
                              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                                <circle cx="24" cy="24" r="20" strokeWidth="4" fill="none" className="stroke-slate-100 dark:stroke-slate-700" />
                                <circle
                                  cx="24"
                                  cy="24"
                                  r="20"
                                  strokeWidth="4"
                                  fill="none"
                                  strokeLinecap="round"
                                  strokeDasharray={`${(ch.proficiency_score / 100) * 125.6} 125.6`}
                                  className={
                                    ch.status === "mastered"
                                      ? "stroke-emerald-500"
                                      : ch.status === "in_progress"
                                      ? "stroke-indigo-500"
                                      : "stroke-amber-500"
                                  }
                                />
                              </svg>
                              <span className="absolute text-xs font-bold text-slate-600 dark:text-slate-300">
                                {ch.proficiency_score.toFixed(0)}
                              </span>
                            </div>

                            <ChevronRight size={20} className="text-slate-300 dark:text-slate-600" />
                          </div>
                        </div>

                        {/* Mobile stats */}
                        {ch.total_attempts > 0 && (
                          <div className="flex sm:hidden items-center flex-wrap gap-x-4 gap-y-2 mt-3 pl-14 text-xs text-slate-400">
                            <span>スコア: {ch.proficiency_score.toFixed(0)}</span>
                            <span>正答率: {ch.accuracy_rate.toFixed(0)}%</span>
                            <span>{ch.total_attempts}問</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </main>
  );
}
