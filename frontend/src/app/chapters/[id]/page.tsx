"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Lock,
  Sparkles,
  Target,
  TrendingUp,
  AlertTriangle,
  XCircle,
  Zap,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import LiveConversationModal from "@/components/LiveConversationModal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface WeakPoint {
  grammar_point: string;
  attempts: number;
  accuracy: number;
}

interface RecentAttempt {
  question_japanese: string;
  user_answer: string;
  is_correct: boolean;
  score: number;
  grammar_point: string;
  created_at: string;
}

interface ScenarioResponse {
  id: number;
  chapter_id: number;
  title: string;
  description: string;
  order_index: number;
  status: string;
  proficiency_score: number;
  total_attempts: number;
  correct_attempts: number;
}

interface ChapterDetail {
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
  weak_grammar_points: WeakPoint[];
  recent_attempts: RecentAttempt[];
  scenarios: ScenarioResponse[];
}

const statusLabels: Record<string, { label: string; color: string }> = {
  locked: { label: "ロック中", color: "text-slate-400" },
  available: { label: "挑戦可能", color: "text-amber-500" },
  in_progress: { label: "学習中", color: "text-indigo-500" },
  mastered: { label: "マスター済", color: "text-emerald-500" },
};

export default function ChapterDetailPage() {
  const params = useParams();
  const chapterId = params.id as string;
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLiveConversation, setShowLiveConversation] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchChapter = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/chapters/${chapterId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setChapter(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchChapter();
  }, [chapterId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
          <Brain className="w-12 h-12 text-indigo-500 animate-bounce" />
          <p className="text-slate-400 font-medium">読み込み中...</p>
        </motion.div>
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
        <p className="text-slate-500">章が見つかりませんでした。</p>
      </div>
    );
  }

  const grammarList = chapter.grammar_points.split(",").map((g) => g.trim());
  const statusInfo = statusLabels[chapter.status] || statusLabels.locked;
  const masteryProgress = Math.min(100, chapter.proficiency_score); // cap at 100
  const attemptsForMastery = Math.max(0, 10 - chapter.total_attempts);
  const scoreForMastery = Math.max(0, 80 - chapter.proficiency_score);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Back navigation */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <Link href="/">
            <button className="flex items-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5 mr-1" /> ダッシュボードへ戻る
            </button>
          </Link>
        </motion.div>

        {/* ── Chapter Header ────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-6 sm:p-8 mb-6 relative overflow-hidden"
        >
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-indigo-500 opacity-5 rounded-full blur-2xl" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center flex-wrap gap-2 sm:gap-3 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-full">
                  {chapter.cefr_level}
                </span>
                <span className={`text-xs font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
              </div>
              <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white mb-2">
                第{chapter.number}章: {chapter.title}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                {chapter.description}
              </p>
            </div>
          </div>

          {/* Grammar point tags */}
          <div className="flex flex-wrap gap-2 mt-4">
            {grammarList.map((gp) => (
              <span
                key={gp}
                className="text-xs font-medium px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full"
              >
                {gp}
              </span>
            ))}
          </div>
        </motion.div>

        {/* ── Stats Grid ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel p-4 sm:p-5 rounded-2xl text-center"
          >
            <div className="relative w-16 h-16 mx-auto mb-3">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" strokeWidth="5" fill="none" className="stroke-slate-100 dark:stroke-slate-700" />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  strokeWidth="5"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(masteryProgress / 100) * 175.9} 175.9`}
                  className={
                    chapter.status === "mastered"
                      ? "stroke-emerald-500"
                      : "stroke-indigo-500"
                  }
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-slate-700 dark:text-white">
                {chapter.proficiency_score.toFixed(0)}
              </span>
            </div>
            <p className="text-xs text-slate-400">習熟度スコア</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-panel p-4 sm:p-5 rounded-2xl text-center"
          >
            <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center">
              <Target size={36} className="text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">{chapter.accuracy_rate.toFixed(1)}%</p>
            <p className="text-xs text-slate-400">正答率</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-panel p-4 sm:p-5 rounded-2xl text-center"
          >
            <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center">
              <BookOpen size={36} className="text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">{chapter.total_attempts}</p>
            <p className="text-xs text-slate-400">解答した問題数</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="glass-panel p-4 sm:p-5 rounded-2xl text-center"
          >
            <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center">
              <TrendingUp size={36} className={chapter.status === "mastered" ? "text-emerald-500" : "text-amber-500"} />
            </div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">
              {chapter.status === "mastered" ? "✅" : `残り${attemptsForMastery > 0 ? attemptsForMastery + "問" : scoreForMastery > 0 ? "スコア+" + scoreForMastery.toFixed(0) : "少し"}`}
            </p>
            <p className="text-xs text-slate-400">マスターまで</p>
          </motion.div>
        </div>

        {/* ── Scenarios List ──────────────────────────────────────── */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.28 }}
           className="mb-8"
        >
          <div className="flex items-center gap-2 mb-4">
            <Target size={20} className="text-indigo-500" />
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">シチュエーション一覧</h2>
          </div>
          <p className="text-sm text-slate-500 mb-6">この章には様々な場面が用意されています。すべての場面をマスターして次の章に進みましょう。</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {chapter.scenarios && chapter.scenarios.map((sc, index) => {
              const scStatus = statusLabels[sc.status] || statusLabels.locked;
              const isLocked = sc.status === "locked";
              return (
                <div key={sc.id} className={`glass-panel p-5 rounded-2xl flex flex-col ${isLocked ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-slate-800 dark:text-white text-lg pr-4">{sc.title}</h3>
                    <div className="flex items-center gap-2">
                       {sc.status === "mastered" && <CheckCircle2 size={20} className="text-emerald-500 flex-shrink-0" />}
                       {isLocked && <Lock size={16} className="text-slate-400 flex-shrink-0" />}
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-1">{sc.description}</p>
                  
                  <div className="flex items-end justify-between mt-auto pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400">習熟度</span>
                      <span className={`font-bold ${sc.status === "mastered" ? "text-emerald-500" : "text-indigo-500"}`}>
                        {sc.proficiency_score.toFixed(0)} <span className="text-xs font-normal text-slate-400">/ 100</span>
                      </span>
                    </div>
                    {!isLocked ? (
                      <Link href={`/practice?chapter=${chapter.id}&scenario=${sc.id}`}>
                        <button className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-bold rounded-full shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5">
                          {sc.status === "mastered" ? "復習する" : "練習する"}
                        </button>
                      </Link>
                    ) : (
                       <button disabled className="px-5 py-2 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 text-sm font-bold rounded-full cursor-not-allowed">
                         ロック中
                       </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* ── Weak Points ──────────────────────────────────────── */}
        {chapter.weak_grammar_points.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="glass-panel rounded-2xl p-5 sm:p-6 mb-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-orange-500" />
              <h3 className="font-bold text-slate-700 dark:text-slate-200">苦手な文法ポイント</h3>
            </div>
            <div className="space-y-4 sm:space-y-3">
              {chapter.weak_grammar_points.map((wp) => (
                <div key={wp.grammar_point} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-orange-500" />
                    <span className="font-medium text-slate-700 dark:text-slate-200">{wp.grammar_point}</span>
                    <span className="text-xs text-slate-400">({wp.attempts}問)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${wp.accuracy < 50 ? "bg-red-500" : "bg-orange-400"}`}
                        style={{ width: `${wp.accuracy}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-500 w-12 text-right">{wp.accuracy.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Recent Attempts ──────────────────────────────────── */}
        {chapter.recent_attempts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="glass-panel rounded-2xl p-5 sm:p-6 mb-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <Clock size={18} className="text-slate-500" />
              <h3 className="font-bold text-slate-700 dark:text-slate-200">直近の解答履歴</h3>
            </div>
            <div className="space-y-3">
              {chapter.recent_attempts.map((a, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-3 rounded-xl ${
                    a.is_correct
                      ? "bg-emerald-50 dark:bg-emerald-900/10"
                      : "bg-rose-50 dark:bg-rose-900/10"
                  }`}
                >
                  <div className={`mt-0.5 ${a.is_correct ? "text-emerald-500" : "text-rose-500"}`}>
                    {a.is_correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 break-words">{a.question_japanese}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">回答: {a.user_answer}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${a.is_correct ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {a.score.toFixed(0)}点
                    </p>
                    <p className="text-xs text-slate-400">{a.grammar_point}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Live Conversation Button ─────────────────────────────────────── */}
        {chapter.status !== "locked" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="glass-panel rounded-2xl p-5 sm:p-6 mb-8"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={18} className="text-violet-500" />
                  <h3 className="font-bold text-slate-700 dark:text-slate-200">音声会話で実践する</h3>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  この章で学んだフレーズを使って、AIと実際に英語で会話しよう。
                </p>
              </div>
              <button
                onClick={() => setShowLiveConversation(true)}
                className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 text-white text-sm font-bold rounded-full shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
                style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
              >
                <Zap size={16} />
                音声で実践する
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Live Conversation Modal (mounted outside the scroll container) */}
      <LiveConversationModal
        isOpen={showLiveConversation}
        onClose={() => setShowLiveConversation(false)}
        chapterId={chapter.id}
        chapterTitle={chapter.title}
      />
    </div>
  );
}
