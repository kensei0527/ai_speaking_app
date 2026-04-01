"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Brain,
  BarChart2,
  Target,
  TrendingUp,
  TrendingDown,
  BookOpen,
  Lightbulb,
  Star,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface GrammarSkill {
  grammar_point: string;
  attempts: number;
  accuracy: number;
  chapter_title: string;
}

interface ChapterScore {
  chapter_title: string;
  chapter_number: number;
  score: number;
  status: string;
}

interface SkillReport {
  strong_skills: GrammarSkill[];
  weak_skills: GrammarSkill[];
  chapter_scores: ChapterScore[];
  ai_summary: string;
}

// Mini bar chart component
function AccuracyBar({ accuracy, label }: { accuracy: number; label: string }) {
  const color =
    accuracy >= 80
      ? "from-emerald-400 to-teal-500"
      : accuracy >= 60
      ? "from-amber-400 to-orange-500"
      : "from-rose-400 to-pink-500";

  return (
    <div className="flex items-center gap-3">
      <div className="w-full">
        <div className="flex justify-between text-xs mb-1">
          <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
          <span
            className={`font-bold ${
              accuracy >= 80
                ? "text-emerald-600"
                : accuracy >= 60
                ? "text-amber-600"
                : "text-rose-600"
            }`}
          >
            {accuracy.toFixed(0)}%
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${accuracy}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={`h-full bg-gradient-to-r ${color} rounded-full`}
          />
        </div>
      </div>
    </div>
  );
}

// Chapter radar-style bar
function ChapterScoreBar({ chapter }: { chapter: ChapterScore }) {
  const statusColors: Record<string, string> = {
    mastered: "from-emerald-400 to-teal-500",
    in_progress: "from-indigo-400 to-purple-500",
    available: "from-amber-400 to-orange-400",
    locked: "from-slate-300 to-slate-400",
  };

  const color = statusColors[chapter.status] || statusColors.locked;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-5 text-right">{chapter.chapter_number}</span>
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
            {chapter.chapter_title}
          </span>
          <span className="font-bold text-slate-500 dark:text-slate-400 ml-2">
            {chapter.score.toFixed(0)}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(chapter.score, 100)}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: chapter.chapter_number * 0.05 }}
            className={`h-full bg-gradient-to-r ${color} rounded-full`}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [report, setReport] = useState<SkillReport | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchReport = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/users/me/report`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setReport(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchReport();
  }, []);

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
          <p className="text-slate-500 dark:text-slate-400 font-medium">スキルレポートを分析中...</p>
        </motion.div>
      </main>
    );
  }

  if (!report) return null;

  const hasData =
    report.strong_skills.length > 0 || report.weak_skills.length > 0;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8 bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
      {/* Header */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-8">
        <Link href="/">
          <button className="flex items-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5 mr-1" /> ダッシュボード
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-indigo-500" />
          <h1 className="text-lg font-bold text-slate-800 dark:text-white">スキルレポート</h1>
        </div>
        <div className="w-24" />
      </div>

      <div className="w-full max-w-3xl space-y-6">
        {/* AI Summary Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-2xl p-5 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={18} className="text-amber-500" />
            <h2 className="font-bold text-slate-700 dark:text-slate-200">AIによる総評</h2>
          </div>
          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
            {report.ai_summary}
          </p>
        </motion.div>

        {hasData ? (
          <>
            {/* Strong & Weak Skills */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Strong Skills */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass-panel rounded-2xl p-5"
              >
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={18} className="text-emerald-500" />
                  <h3 className="font-bold text-slate-700 dark:text-slate-200">得意な文法</h3>
                </div>
                {report.strong_skills.length > 0 ? (
                  <div className="space-y-4">
                    {report.strong_skills.map((skill) => (
                      <div key={skill.grammar_point}>
                        <AccuracyBar
                          accuracy={skill.accuracy}
                          label={skill.grammar_point}
                        />
                        <p className="text-xs text-slate-400 mt-1 ml-0">
                          {skill.chapter_title} • {skill.attempts}回
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">まだデータがありません</p>
                )}
              </motion.div>

              {/* Weak Skills */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-panel rounded-2xl p-5"
              >
                <div className="flex items-center gap-2 mb-4">
                  <TrendingDown size={18} className="text-rose-500" />
                  <h3 className="font-bold text-slate-700 dark:text-slate-200">苦手な文法</h3>
                </div>
                {report.weak_skills.length > 0 ? (
                  <div className="space-y-4">
                    {report.weak_skills.map((skill) => (
                      <div key={skill.grammar_point}>
                        <AccuracyBar
                          accuracy={skill.accuracy}
                          label={skill.grammar_point}
                        />
                        <p className="text-xs text-slate-400 mt-1">
                          {skill.chapter_title} • {skill.attempts}回
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">まだデータがありません</p>
                )}
              </motion.div>
            </div>

            {/* Chapter Progress Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-panel rounded-2xl p-5 sm:p-6"
            >
              <div className="flex items-center gap-2 mb-5">
                <BookOpen size={18} className="text-indigo-500" />
                <h3 className="font-bold text-slate-700 dark:text-slate-200">章ごとの習熟スコア</h3>
              </div>
              <div className="space-y-3.5">
                {report.chapter_scores.map((ch) => (
                  <ChapterScoreBar key={ch.chapter_number} chapter={ch} />
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-5 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 inline-block" />
                  マスター済
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-indigo-400 to-purple-500 inline-block" />
                  学習中
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 inline-block" />
                  挑戦可能
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-gradient-to-r from-slate-300 to-slate-400 inline-block" />
                  ロック中
                </span>
              </div>
            </motion.div>
          </>
        ) : (
          /* No data yet */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-2xl p-10 text-center"
          >
            <Star size={48} className="text-slate-300 dark:text-slate-600 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-slate-600 dark:text-slate-300 mb-2">
              まだレポートがありません
            </h2>
            <p className="text-slate-400 text-sm mb-6">
              レッスンを始めると、ここに文法別の得意・苦手が記録されます。
            </p>
            <Link href="/">
              <button className="px-6 py-3 bg-indigo-600 text-white rounded-full font-bold hover:bg-indigo-500 transition-colors">
                ダッシュボードへ
              </button>
            </Link>
          </motion.div>
        )}
      </div>
    </main>
  );
}
