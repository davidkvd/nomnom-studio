'use client';

import { useState, useTransition } from 'react';
import { UploadZone }        from '@/components/dashboard/UploadZone';
import { ControlPanel }      from '@/components/dashboard/ControlPanel';
import { JobProgressCard }   from '@/components/dashboard/JobProgressCard';
import { CreditMeter }       from '@/components/dashboard/CreditMeter';
import { NotificationBell }  from '@/components/dashboard/NotificationBell';
import type { VibeMode, AspectRatioKey, Profile, ProcessingJob } from '@/types';
import { MAX_FILES } from '@/types';

interface DashboardClientProps {
  profile: Profile;
  initialJobs: ProcessingJob[];
}

export function DashboardClient({ profile, initialJobs }: DashboardClientProps) {
  // ── Form state ─────────────────────────────────────────────
  const [files, setFiles]   = useState<File[]>([]);
  const [vibe, setVibe]     = useState<VibeMode>(profile.default_vibe);
  const [ratio, setRatio]   = useState<AspectRatioKey>(profile.default_ratio);

  // ── Job tracking ───────────────────────────────────────────
  const [activeJobIds, setActiveJobIds]  = useState<string[]>(
    initialJobs
      .filter(j => j.status === 'queued' || j.status === 'processing')
      .map(j => j.id)
  );
  const [historyJobIds, setHistoryJobIds] = useState<string[]>(
    initialJobs
      .filter(j => j.status !== 'queued' && j.status !== 'processing')
      .map(j => j.id)
  );

  // ── Submission ─────────────────────────────────────────────
  const [isPending, startTransition]  = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optimistic credit count for immediate UI feedback
  const [creditOffset, setCreditOffset] = useState(0);
  const optimisticProfile = {
    ...profile,
    monthly_credits: Math.max(0, profile.monthly_credits - creditOffset),
    topup_credits:   Math.max(0, profile.topup_credits - Math.max(0, creditOffset - profile.monthly_credits)),
    credits_used_cycle: profile.credits_used_cycle + creditOffset,
  };

  const totalCredits = profile.monthly_credits + profile.topup_credits;
  const canSubmit = files.length > 0 && totalCredits >= files.length && !isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('vibe', vibe);
    formData.append('ratio', ratio);

    // Optimistic credit deduction
    const charged = files.length;
    setCreditOffset(prev => prev + charged);

    startTransition(async () => {
      try {
        const res = await fetch('/api/process', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Server error ${res.status}`);
        }

        const { jobId } = await res.json();

        // Move new job to the top of active list
        setActiveJobIds(prev => [jobId, ...prev]);

        // Clear upload form
        setFiles([]);
      } catch (err: unknown) {
        // Rollback optimistic update
        setCreditOffset(prev => prev - charged);
        setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    });
  };

  const dismissJob = (jobId: string) => {
    setActiveJobIds(prev  => prev.filter(id => id !== jobId));
    setHistoryJobIds(prev => prev.filter(id => id !== jobId));
  };

  const moveToHistory = (jobId: string) => {
    setActiveJobIds(prev  => prev.filter(id => id !== jobId));
    setHistoryJobIds(prev => [jobId, ...prev]);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">

      {/* ── Top Navigation ─────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2.5 group">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-base">
              🍽
            </span>
            <span className="text-sm font-bold text-white tracking-tight">
              NomNom <span className="text-amber-400">Studio</span>
            </span>
          </a>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <NotificationBell userId={profile.id} />
            <a
              href="/billing"
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5
                         text-xs font-semibold text-neutral-300 hover:border-neutral-700
                         hover:text-white transition-colors"
            >
              Billing
            </a>
            <UserAvatar profile={profile} />
          </div>
        </div>
      </header>

      {/* ── Main Layout ────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[1fr_280px] lg:gap-8">

        {/* ── Left Column: Main workarea ────────────────────── */}
        <main className="space-y-8">

          {/* Page heading */}
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              AI Food Studio
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Upload your food photos and let AI transform them into 4K studio shots.
            </p>
          </div>

          {/* ── Upload Card ─────────────────────────────────── */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 sm:p-6 space-y-6">

            {/* Section header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-100">Upload Zone</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {files.length === 0
                    ? `Up to ${MAX_FILES} photos per batch`
                    : `${files.length} of ${MAX_FILES} selected`}
                </p>
              </div>
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Upload drop zone */}
            <UploadZone
              files={files}
              onChange={setFiles}
              disabled={isPending}
            />

            {/* Divider */}
            <div className="border-t border-neutral-800" />

            {/* Control Panel */}
            <ControlPanel
              vibe={vibe}
              onVibeChange={setVibe}
              ratio={ratio}
              onRatioChange={setRatio}
              disabled={isPending}
            />

            {/* Submit error */}
            {submitError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-red-400">{submitError}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={[
                'w-full rounded-xl py-3.5 text-sm font-bold tracking-wide transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900',
                canSubmit
                  ? 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.99] shadow-lg shadow-amber-500/20'
                  : 'bg-neutral-800 text-neutral-600 cursor-not-allowed',
              ].join(' ')}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Uploading…
                </span>
              ) : files.length === 0 ? (
                'Select images to begin'
              ) : totalCredits < files.length ? (
                `Not enough credits · need ${files.length - totalCredits} more`
              ) : (
                `Enhance ${files.length} ${files.length === 1 ? 'Photo' : 'Photos'} → 4K  ·  ${files.length} credit${files.length !== 1 ? 's' : ''}`
              )}
            </button>
          </section>

          {/* ── Active Jobs ──────────────────────────────────── */}
          {activeJobIds.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
                Processing
              </h2>
              {activeJobIds.map(jobId => (
                <JobProgressCard
                  key={jobId}
                  jobId={jobId}
                  onDismiss={() => dismissJob(jobId)}
                />
              ))}
            </section>
          )}

          {/* ── History ──────────────────────────────────────── */}
          {historyJobIds.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
                  History
                </h2>
                <span className="text-xs text-neutral-700">{historyJobIds.length} batch{historyJobIds.length !== 1 ? 'es' : ''}</span>
              </div>
              {historyJobIds.map(jobId => (
                <JobProgressCard
                  key={jobId}
                  jobId={jobId}
                  onDismiss={() => dismissJob(jobId)}
                />
              ))}
            </section>
          )}

          {/* Empty state */}
          {activeJobIds.length === 0 && historyJobIds.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 py-16 text-center">
              <div className="mb-4 text-4xl">📸</div>
              <p className="text-sm font-medium text-neutral-400">No jobs yet</p>
              <p className="mt-1 text-xs text-neutral-600">Upload photos above to get started</p>
            </div>
          )}
        </main>

        {/* ── Right Sidebar ─────────────────────────────────── */}
        <aside className="mt-8 space-y-5 lg:mt-0">

          {/* Credit meter */}
          <CreditMeter profile={optimisticProfile} />

          {/* Plan upgrade */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Your Plan</p>

            <div className="space-y-2">
              <PlanFeature text="4K JPG output" />
              <PlanFeature text="Natural + Studio vibes" />
              <PlanFeature text="Batch up to 20 photos" />
              <PlanFeature text="Real-time progress" />
              <PlanFeature text="ZIP download" />
              <PlanFeature text={`${profile.plan === 'free' ? '3' : profile.plan === 'starter' ? '20' : profile.plan === 'pro' ? '100' : '500'} images / month`} />
            </div>

            {profile.plan === 'free' && (
              <a
                href="/billing"
                className="block w-full rounded-xl bg-neutral-800 py-2.5 text-center text-xs font-bold
                           text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                Upgrade Plan →
              </a>
            )}
          </div>

          {/* Tips */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Pro Tips</p>
            <div className="space-y-2.5">
              <Tip
                icon="☀️"
                text="Use Natural Light for rustic, café-style content. Works best with warm-toned dishes."
              />
              <Tip
                icon="💡"
                text="Studio Light is perfect for delivery app thumbnails and editorial menus."
              />
              <Tip
                icon="📱"
                text="Choose 9:16 for TikTok/Reels, 1:1 for Instagram Grid, 4:5 for portrait feeds."
              />
              <Tip
                icon="📦"
                text="Upload up to 20 photos at once for bulk discounts."
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────

function PlanFeature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
      </svg>
      <span className="text-xs text-neutral-400">{text}</span>
    </div>
  );
}

function Tip({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="flex-shrink-0 text-sm">{icon}</span>
      <p className="text-[11px] text-neutral-500 leading-relaxed">{text}</p>
    </div>
  );
}

function UserAvatar({ profile }: { profile: Profile }) {
  const initials = profile.full_name
    ? profile.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : profile.email.slice(0, 2).toUpperCase();

  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20
                 border border-amber-500/30 text-xs font-bold text-amber-400 select-none"
      title={profile.full_name ?? profile.email}
    >
      {initials}
    </div>
  );
}
