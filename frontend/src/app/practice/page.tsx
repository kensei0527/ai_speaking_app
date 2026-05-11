"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  Mic,
  MicOff,
  CheckCircle2,
  XCircle,
  Brain,
  BookOpen,
  Target,
  Sparkles,
  MessageSquare,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Trophy,
  RotateCcw,
  Home,
  Star,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useBrowserSpeechRecognition } from "@/hooks/useBrowserSpeechRecognition";

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

interface LessonQuestion {
  id: number;
  japanese_text: string;
  grammar_point: string;
  difficulty: number;
  order_index: number;
}

interface LessonIntroPhrase {
  phrase: string;
  meaning: string;
  usage_note: string;
  example: string;
}

interface LessonIntro {
  title: string;
  body: string;
  phrases: LessonIntroPhrase[];
}

interface LessonData {
  lesson_id: number;
  chapter_id: number;
  scenario_id?: number | null;
  is_review?: boolean;
  lesson_intro?: LessonIntro | null;
  questions: LessonQuestion[];
  total_questions: number;
}

interface AnswerResult {
  question_id: number;
  order_index: number;
  japanese_text: string;
  user_answer: string;
  is_correct: boolean;
  score: number;
  evaluation_level: string;
  feedback_text: string;
  expected_english: string;
  grammar_point: string;
  alternative_expressions: string[];
  naturalness_tips: string[];
}

interface LessonResult {
  lesson_id: number;
  chapter_id: number;
  total_questions: number;
  correct_count: number;
  accuracy_rate: number;
  average_score: number;
  chapter_mastered: boolean;
  next_chapter_unlocked: boolean;
  results: AnswerResult[];
}

type VoiceInputState = ReturnType<typeof useBrowserSpeechRecognition>;

// ─── Sub-components ──────────────────────────────────────────────────────────

function DifficultyDots({ level }: { level: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i <= level ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"
          }`}
        />
      ))}
    </div>
  );
}

function ExpandableSection({
  title,
  icon,
  items,
  colorClass,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  colorClass: string;
}) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;

  return (
    <div className={`rounded-xl border overflow-hidden ${colorClass}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 pb-3 space-y-1.5 overflow-hidden"
          >
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm opacity-90">
                <span className="mt-0.5 text-xs">•</span>
                <span>{item}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Phase: Loading ───────────────────────────────────────────────────────────

function LoadingScreen({ chapter }: { chapter: ChapterInfo | null }) {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="flex flex-col items-center justify-center p-12 glass-panel rounded-3xl text-center"
    >
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-30 rounded-full animate-pulse" />
        <Brain className="w-16 h-16 text-indigo-500 animate-bounce relative z-10" />
      </div>
      <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">
        レッスンを準備中...
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
        {chapter
          ? `「${chapter.title}」の講義と問題を準備しています`
          : "講義と問題を準備しています"}
      </p>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
            className="w-2 h-2 rounded-full bg-indigo-400"
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Phase: Input / Lecture ──────────────────────────────────────────────────

function IntroPhase({
  lesson,
  chapter,
  onStart,
}: {
  lesson: LessonData;
  chapter: ChapterInfo | null;
  onStart: () => void;
}) {
  const intro = lesson.lesson_intro;
  if (!intro) return null;

  return (
    <motion.div
      key="intro"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      className="glass-panel rounded-3xl p-6 sm:p-8"
    >
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
          <Lightbulb size={24} />
        </div>
        <div>
          <p className="mb-1 text-xs font-bold uppercase text-indigo-500">
            {chapter ? `第${chapter.number}章: ${chapter.title}` : "Lesson Input"}
          </p>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">{intro.title}</h1>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {intro.body}
      </p>

      {intro.phrases.length > 0 && (
        <div className="mt-6 space-y-3">
          {intro.phrases.map((item, index) => (
            <div
              key={`${item.phrase}-${index}`}
              className="rounded-2xl border border-slate-100 bg-white/50 p-4 dark:border-slate-700/70 dark:bg-slate-900/30"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="text-lg font-extrabold text-slate-800 dark:text-white">{item.phrase}</p>
                <p className="text-sm font-medium text-indigo-500">{item.meaning}</p>
              </div>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{item.usage_note}</p>
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                {item.example}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
          まず型を確認してから、{lesson.total_questions}問の英作文に進みます。
        </p>
        <button
          onClick={onStart}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500"
        >
          問題へ進む
          <ArrowRight size={18} />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Phase: Practice (one question at a time) ─────────────────────────────────

function PracticePhase({
  lesson,
  chapter,
  currentIndex,
  answer,
  onAnswerChange,
  onAnswerSubmitted,
  voiceInput,
}: {
  lesson: LessonData;
  chapter: ChapterInfo | null;
  currentIndex: number;
  answer: string;
  onAnswerChange: (answer: string) => void;
  onAnswerSubmitted: (questionId: number, answer: string) => void;
  voiceInput: VoiceInputState;
}) {
  const question = lesson.questions[currentIndex];
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleSubmit = () => {
    if (!answer.trim()) return;
    onAnswerSubmitted(question.id, answer.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (answer.trim()) handleSubmit();
    }
  };

  const handleVoiceToggle = () => {
    if (voiceInput.listening) {
      voiceInput.stop();
    } else {
      voiceInput.start();
    }
  };

  const progress = ((currentIndex) / lesson.total_questions) * 100;
  const voiceButtonLabel = voiceInput.listening ? "聞き取り停止" : "音声で回答";

  return (
    <motion.div
      key={`q-${currentIndex}`}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      className="flex flex-col gap-5"
    >
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-2">
          <span>
            {currentIndex + 1} / {lesson.total_questions} 問
          </span>
          <span>{chapter?.title}</span>
        </div>
        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: `${((currentIndex - 1) / lesson.total_questions) * 100}%` }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full"
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="glass-panel p-6 sm:p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-6 h-24 bg-indigo-500 rounded-r-lg opacity-80" />
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 dark:bg-indigo-900/50 dark:text-indigo-300 rounded-full">
            {question.grammar_point}
          </span>
          <DifficultyDots level={question.difficulty} />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white leading-relaxed">
          {question.japanese_text}
        </h2>
        <p className="text-xs text-slate-400 mt-3">↑ この日本語を英語にしてください</p>
      </div>

      {/* Input */}
      <div className="glass-panel p-5 sm:p-6 rounded-3xl shadow-lg focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleVoiceToggle}
              disabled={!voiceInput.supported}
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                voiceInput.listening
                  ? "bg-rose-500 text-white shadow-rose-500/25"
                  : "bg-indigo-600 text-white shadow-indigo-500/25 hover:bg-indigo-500"
              }`}
              aria-label={voiceButtonLabel}
              title={voiceButtonLabel}
            >
              {voiceInput.listening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            <div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{voiceButtonLabel}</p>
              <p className="text-xs text-slate-400">
                {voiceInput.listening
                  ? "聞き取り中..."
                  : voiceInput.supported
                  ? "待機中"
                  : "音声入力は使えません"}
              </p>
            </div>
          </div>
          {voiceInput.error && (
            <p className="text-xs font-medium text-rose-500 sm:text-right">{voiceInput.error}</p>
          )}
        </div>

        <textarea
          ref={inputRef}
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="英語で話すか入力してください..."
          className="w-full bg-transparent text-lg text-slate-800 dark:text-white placeholder:text-slate-400 outline-none resize-none min-h-[100px]"
        />
        {voiceInput.interimTranscript && (
          <div className="mt-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm text-indigo-700 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900/50">
            {voiceInput.interimTranscript}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-stretch sm:items-center mt-4 gap-3">
          <span className="text-xs text-slate-400 hidden sm:block">
            <kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-md">Enter</kbd> で送信
          </span>
          <button
            onClick={handleSubmit}
            disabled={!answer.trim()}
            className="flex justify-center items-center px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-full font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all sm:hover:scale-105 active:scale-95"
          >
            <Send className="w-5 h-5 mr-2" />
            回答する
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Phase: Evaluating ────────────────────────────────────────────────────────

function EvaluatingScreen({ total }: { total: number }) {
  return (
    <motion.div
      key="evaluating"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="flex flex-col items-center justify-center p-12 glass-panel rounded-3xl text-center"
    >
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-purple-500 blur-xl opacity-30 rounded-full animate-pulse" />
        <Sparkles className="w-16 h-16 text-purple-500 animate-spin relative z-10" style={{ animationDuration: "3s" }} />
      </div>
      <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">
        AIが{total}問を採点中...
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-sm">
        別解や自然な表現のアドバイスも分析しています
      </p>
      <div className="mt-6 flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.1 }}
            className="w-2 h-2 rounded-full bg-purple-400"
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Phase: Results ───────────────────────────────────────────────────────────

function ResultCard({
  result,
  index,
}: {
  result: AnswerResult;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className={`rounded-2xl p-5 border ${
        result.is_correct
          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40"
          : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/40"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`p-2 rounded-xl text-white flex-shrink-0 ${
            result.evaluation_level === "Perfect" || result.evaluation_level === "Great"
              ? "bg-emerald-500"
              : result.evaluation_level === "Good"
              ? "bg-amber-500"
              : "bg-rose-500"
          }`}
        >
          {result.evaluation_level === "Perfect" || result.evaluation_level === "Great" ? (
            <CheckCircle2 size={20} />
          ) : result.evaluation_level === "Good" ? (
            <Target size={20} />
          ) : (
            <XCircle size={20} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 dark:text-white text-sm mb-0.5">
            Q{index + 1}: {result.japanese_text}
          </p>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{result.grammar_point}</span>
            <span
              className={`font-bold px-2 py-0.5 rounded ${
                result.evaluation_level === "Perfect"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : result.evaluation_level === "Great"
                  ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                  : result.evaluation_level === "Good"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
              }`}
            >
              {result.evaluation_level} ({result.score.toFixed(0)}点)
            </span>
          </div>
        </div>
      </div>

      {/* Answers */}
      <div className="space-y-2 mb-4">
        <div className="rounded-lg bg-white/60 dark:bg-black/20 px-4 py-2 text-sm">
          <p className="text-xs text-slate-400 mb-0.5">あなたの回答</p>
          <p className="font-medium text-slate-700 dark:text-slate-200">{result.user_answer}</p>
        </div>
        {!result.is_correct && (
          <div className="rounded-lg bg-white/60 dark:bg-black/20 px-4 py-2 text-sm">
            <p className="text-xs text-slate-400 mb-0.5">模範解答</p>
            <p className="font-medium text-emerald-700 dark:text-emerald-300">{result.expected_english}</p>
          </div>
        )}
      </div>

      {/* AI Feedback */}
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed">
        {result.feedback_text}
      </p>

      {/* Alternative Expressions */}
      <ExpandableSection
        title="別の言い方"
        icon={<MessageSquare size={14} />}
        items={result.alternative_expressions}
        colorClass="border-blue-100 dark:border-blue-900/40 text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/10"
      />

      {/* Naturalness Tips */}
      {result.naturalness_tips && result.naturalness_tips.length > 0 && (
        <div className="mt-2">
          <ExpandableSection
            title="より自然な表現のコツ"
            icon={<Lightbulb size={14} />}
            items={result.naturalness_tips}
            colorClass="border-amber-100 dark:border-amber-900/40 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/10"
          />
        </div>
      )}
    </motion.div>
  );
}

function ResultsPhase({
  lessonResult,
  chapterId,
  startReviewLesson,
}: {
  lessonResult: LessonResult;
  chapterId: string;
  startReviewLesson: (mode: "weak" | "all") => void;
}) {
  const accuracy = lessonResult.accuracy_rate;
  const isGreat = accuracy >= 80;
  const isGood = accuracy >= 60;

  return (
    <motion.div
      key="results"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-6"
    >
      {/* Summary Card */}
      <div
        className={`glass-panel rounded-3xl p-6 sm:p-8 text-center relative overflow-hidden ${
          isGreat
            ? "border border-emerald-200 dark:border-emerald-800/40"
            : isGood
            ? "border border-amber-200 dark:border-amber-800/40"
            : "border border-rose-200 dark:border-rose-800/40"
        }`}
      >
        <div
          className={`absolute inset-0 opacity-5 ${
            isGreat ? "bg-emerald-400" : isGood ? "bg-amber-400" : "bg-rose-400"
          }`}
        />

        <div className="relative z-10">
          <div
            className={`w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center text-4xl shadow-lg ${
              isGreat
                ? "bg-gradient-to-br from-emerald-400 to-teal-500"
                : isGood
                ? "bg-gradient-to-br from-amber-400 to-orange-500"
                : "bg-gradient-to-br from-rose-400 to-pink-500"
            }`}
          >
            {isGreat ? "🏆" : isGood ? "⭐" : "💪"}
          </div>

          <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-1">
            レッスン完了！
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            {isGreat ? "素晴らしい！" : isGood ? "よくできました！" : "次回も頑張りましょう！"}
          </p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="glass-panel rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-1">正答率</p>
              <p
                className={`text-2xl font-extrabold ${
                  isGreat ? "text-emerald-500" : isGood ? "text-amber-500" : "text-rose-500"
                }`}
              >
                {accuracy.toFixed(0)}%
              </p>
            </div>
            <div className="glass-panel rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-1">正解数</p>
              <p className="text-2xl font-extrabold text-slate-700 dark:text-slate-200">
                {lessonResult.correct_count}
                <span className="text-sm text-slate-400">/{lessonResult.total_questions}</span>
              </p>
            </div>
            <div className="glass-panel rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-1">平均スコア</p>
              <p className="text-2xl font-extrabold text-indigo-500">
                {lessonResult.average_score.toFixed(0)}
              </p>
            </div>
          </div>

          {/* Mastery notifications */}
          {lessonResult.chapter_mastered && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mb-4 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg"
            >
              <Trophy size={20} />
              この章をマスターしました！
            </motion.div>
          )}
          {lessonResult.next_chapter_unlocked && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mb-4 py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg"
            >
              <Sparkles size={20} />
              次の章がアンロックされました！
            </motion.div>
          )}
        </div>
      </div>

      {/* Detailed results */}
      <div>
        <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <Star size={16} className="text-amber-500" />
          問題ごとの結果
        </h3>
        <div className="space-y-3">
          {lessonResult.results.map((r, i) => (
            <ResultCard key={r.question_id} result={r} index={i} />
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button 
            onClick={() => startReviewLesson("weak")}
            className="w-full py-4 rounded-full font-bold text-slate-700 dark:text-slate-200 glass-panel hover:shadow-lg transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2"
          >
            <RotateCcw size={18} className="text-rose-500" />
            間違えを復習する
          </button>
          <button 
            onClick={() => startReviewLesson("all")}
            className="w-full py-4 rounded-full font-bold text-slate-700 dark:text-slate-200 glass-panel hover:shadow-lg transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2"
          >
            <RotateCcw size={18} className="text-indigo-500" />
            全問復習する
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link href={`/chapters/${chapterId}`} className="flex-1">
            <button className="w-full py-4 rounded-full font-bold text-slate-700 dark:text-slate-200 glass-panel hover:shadow-lg transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <ArrowLeft size={18} />
              章の詳細へ戻る
            </button>
          </Link>
          <Link href="/" className="flex-1">
            <button className="w-full py-4 rounded-full font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-lg transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2">
              <Home size={18} />
              ダッシュボード
            </button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Phase = "loading" | "intro" | "practicing" | "evaluating" | "results";

function PracticeContent() {
  const searchParams = useSearchParams();
  const chapterId = searchParams.get("chapter");

  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<{ question_id: number; user_answer: string }[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [lessonResult, setLessonResult] = useState<LessonResult | null>(null);

  const appendVoiceTranscript = useCallback((text: string) => {
    const cleanedText = text.trim();
    if (!cleanedText) return;

    setCurrentAnswer((existingAnswer) => {
      const trimmedAnswer = existingAnswer.trimEnd();
      return trimmedAnswer ? `${trimmedAnswer} ${cleanedText}` : cleanedText;
    });
  }, []);

  const voiceInput = useBrowserSpeechRecognition({
    lang: "en-US",
    onFinalTranscript: appendVoiceTranscript,
  });
  const { resetInterim: resetVoiceInterim, stop: stopVoiceInput } = voiceInput;

  const getSession = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return null;
    }
    return session;
  }, []);

  useEffect(() => {
    setCurrentAnswer("");
    resetVoiceInterim();
  }, [currentIndex, lesson?.lesson_id, resetVoiceInterim]);

  useEffect(() => {
    if (phase !== "practicing") {
      stopVoiceInput();
    }
  }, [phase, stopVoiceInput]);

  // Load chapter info
  useEffect(() => {
    if (!chapterId) return;
    const fetchChapter = async () => {
      const session = await getSession();
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
  }, [chapterId, getSession]);

  // Start lesson
  useEffect(() => {
    if (!chapterId) return;
    
    // Only auto-start on load if we don't have a lesson yet
    if (lesson !== null) return;
    
    const startLesson = async () => {
      const session = await getSession();
      if (!session) return;
      
      const scenarioId = searchParams.get("scenario");
      const reviewLessonId = searchParams.get("review_from");
      const reviewMode = searchParams.get("review_mode");

      try {
        let res;
        if (reviewLessonId && reviewMode) {
          // It's a review
          res = await fetch(`${API_URL}/api/lessons/${reviewLessonId}/review`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ mode: reviewMode }),
          });
        } else if (scenarioId) {
          // Standard scenario start
          res = await fetch(`${API_URL}/api/lessons/start`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ scenario_id: parseInt(scenarioId) }),
          });
        } else {
           console.error("Neither scenario_id nor review_lesson_id provided");
           return;
        }

        if (!res.ok) throw new Error("Failed to start lesson");
        const data: LessonData = await res.json();
        setLesson(data);
        setPhase(data.lesson_intro ? "intro" : "practicing");
      } catch (err) {
        console.error(err);
      }
    };
    startLesson();
  }, [chapterId, searchParams, lesson, getSession]);

  const handleAnswerSubmitted = (questionId: number, userAnswer: string) => {
    const newAnswers = [...answers, { question_id: questionId, user_answer: userAnswer }];
    setAnswers(newAnswers);

    const nextIndex = currentIndex + 1;
    if (nextIndex < (lesson?.total_questions ?? 0)) {
      setCurrentIndex(nextIndex);
    } else {
      // All answered → submit for evaluation
      submitLesson(newAnswers);
    }
  };

  const submitLesson = async (finalAnswers: { question_id: number; user_answer: string }[]) => {
    if (!lesson) return;
    setPhase("evaluating");

    const session = await getSession();
    if (!session) return;

    try {
      const res = await fetch(`${API_URL}/api/lessons/${lesson.lesson_id}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      if (!res.ok) throw new Error("Failed to complete lesson");
      const result: LessonResult = await res.json();
      setLessonResult(result);
      setPhase("results");
    } catch (err) {
      console.error(err);
      setPhase("practicing"); // fallback
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

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4 py-8">
      {/* Header */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-6">
        <Link href={`/chapters/${chapterId}`}>
          <button className="flex items-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5 mr-1" /> 章の詳細へ
          </button>
        </Link>
        {chapter && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <BookOpen size={16} />
            <span className="font-medium">第{chapter.number}章: {chapter.title}</span>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-3xl flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {phase === "loading" && <LoadingScreen key="loading" chapter={chapter} />}

          {phase === "intro" && lesson && (
            <IntroPhase
              key={`intro-${lesson.lesson_id}`}
              lesson={lesson}
              chapter={chapter}
              onStart={() => setPhase("practicing")}
            />
          )}

          {phase === "practicing" && lesson && (
            <PracticePhase
              key={`practicing-${currentIndex}`}
              lesson={lesson}
              chapter={chapter}
              currentIndex={currentIndex}
              answer={currentAnswer}
              onAnswerChange={setCurrentAnswer}
              onAnswerSubmitted={handleAnswerSubmitted}
              voiceInput={voiceInput}
            />
          )}

          {phase === "evaluating" && (
            <EvaluatingScreen key="evaluating" total={lesson?.total_questions ?? 0} />
          )}

          {phase === "results" && lessonResult && (
            <ResultsPhase
              key="results"
              lessonResult={lessonResult}
              chapterId={chapterId}
              startReviewLesson={async (mode) => {
                const url = new URL(window.location.href);
                url.searchParams.set("review_from", lessonResult.lesson_id.toString());
                url.searchParams.set("review_mode", mode);
                url.searchParams.delete("scenario"); // clean up
                window.history.pushState({}, "", url.toString());
                
                // Reset states to run effect again
                setLesson(null);
                setAnswers([]);
                setCurrentIndex(0);
                setCurrentAnswer("");
                setLessonResult(null);
                setPhase("loading");
              }}
            />
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
