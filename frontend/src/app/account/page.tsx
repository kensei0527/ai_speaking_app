"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface AccountInfo {
  id: string;
  name: string;
  email: string;
  proficiency_score: number;
  cefr_level: string;
  placement_status: string;
  placement_score: number | null;
  placement_completed_at: string | null;
  recommended_chapter_id: number | null;
  created_at: string;
}

interface ChapterProgress {
  id: number;
  number: number;
  title: string;
  cefr_level: string;
}

interface UserStats {
  chapter_progress: ChapterProgress[];
}

function formatDate(value: string | null) {
  if (!value) return "未実施";
  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function AccountPage() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [chapters, setChapters] = useState<ChapterProgress[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAccount = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      try {
        const [accountRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/api/users/me`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          fetch(`${API_URL}/api/users/me/stats`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
        ]);

        if (!accountRes.ok) throw new Error("Failed to load account");
        const accountData: AccountInfo = await accountRes.json();
        setAccount(accountData);
        setName(accountData.name);

        if (statsRes.ok) {
          const statsData: UserStats = await statsRes.json();
          setChapters(statsData.chapter_progress || []);
        }
      } catch (err) {
        console.error(err);
        setError("アカウント情報を読み込めませんでした。");
      } finally {
        setLoading(false);
      }
    };
    loadAccount();
  }, []);

  const recommendedChapter = useMemo(() => {
    if (!account) return null;
    return chapters.find((chapter) => chapter.id === account.recommended_chapter_id) || null;
  }, [account, chapters]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("名前を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to update account");
      const updated: AccountInfo = await res.json();
      setAccount(updated);
      setName(updated.name);
      setMessage("保存しました。");
    } catch (err) {
      console.error(err);
      setError("保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </main>
    );
  }

  if (!account) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4">
        <p className="text-slate-500">{error || "アカウント情報が見つかりませんでした。"}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/">
            <button className="flex items-center text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
              <ArrowLeft className="mr-1 h-5 w-5" /> ダッシュボード
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <UserCircle size={20} className="text-indigo-500" />
            <h1 className="text-lg font-bold text-slate-800 dark:text-white">アカウント</h1>
          </div>
          <div className="w-24" />
        </div>

        <div className="space-y-5">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-2xl p-5 sm:p-6"
          >
            <div className="mb-5 flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-500" />
              <h2 className="font-bold text-slate-700 dark:text-slate-200">基本情報</h2>
            </div>
            <form onSubmit={saveName} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-500 dark:text-slate-400">
                  表示名
                </label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="block w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900/40 dark:text-white dark:focus:ring-indigo-950"
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">メールアドレス</p>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  <Mail size={18} className="text-slate-400" />
                  <span>{account.email}</span>
                </div>
              </div>
              {(message || error) && (
                <p className={`text-sm ${error ? "text-rose-500" : "text-emerald-500"}`}>
                  {error || message}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存する
              </button>
            </form>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="glass-panel rounded-2xl p-5 sm:p-6"
          >
            <div className="mb-5 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-500" />
              <h2 className="font-bold text-slate-700 dark:text-slate-200">英語力判定</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-white/60 p-4 dark:bg-slate-900/30">
                <p className="text-xs text-slate-400">現在のCEFR</p>
                <p className="mt-1 text-3xl font-extrabold text-indigo-500">{account.cefr_level}</p>
              </div>
              <div className="rounded-xl bg-white/60 p-4 dark:bg-slate-900/30">
                <p className="text-xs text-slate-400">判定スコア</p>
                <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">
                  {account.placement_score !== null ? account.placement_score.toFixed(0) : "-"}
                </p>
              </div>
              <div className="rounded-xl bg-white/60 p-4 dark:bg-slate-900/30">
                <p className="text-xs text-slate-400">判定日</p>
                <div className="mt-2 flex items-start gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Calendar size={16} className="mt-0.5 text-slate-400" />
                  <span>{formatDate(account.placement_completed_at)}</span>
                </div>
              </div>
            </div>

            {recommendedChapter ? (
              <div className="mt-5 flex flex-col gap-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-4 dark:border-cyan-900/50 dark:bg-cyan-950/20 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <BookOpen size={20} className="mt-0.5 text-cyan-600 dark:text-cyan-400" />
                  <div>
                    <p className="text-sm font-bold text-cyan-800 dark:text-cyan-200">おすすめ開始章</p>
                    <p className="text-sm text-cyan-700 dark:text-cyan-300">
                      第{recommendedChapter.number}章: {recommendedChapter.title}
                    </p>
                  </div>
                </div>
                <Link href={`/chapters/${recommendedChapter.id}`}>
                  <button className="rounded-full bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-500">
                    章を開く
                  </button>
                </Link>
              </div>
            ) : account.placement_status !== "completed" ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                初回レベル判定が未完了です。
                <Link href="/onboarding/placement" className="ml-2 font-bold underline">
                  判定テストへ進む
                </Link>
              </div>
            ) : null}
          </motion.section>
        </div>
      </div>
    </main>
  );
}
