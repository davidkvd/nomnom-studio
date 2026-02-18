'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useJobProgress } from '@/hooks/useJobProgress';
import { DownloadAllButton } from './DownloadAllButton';
import { VIBE_LABELS, ASPECT_RATIO_MAP } from '@/types';
import type { ProcessedImage, JobStatus } from '@/types';

interface JobProgressCardProps {
  jobId: string;
  onDismiss?: () => void;
}

export function JobProgressCard({ jobId, onDismiss }: JobProgressCardProps) {
  const { job, images, progressPct, isLoading } = useJobProgress(jobId);
  const prevStatusRef = useRef<JobStatus | null>(null);

  // Play completion sound effect (subtle)
  useEffect(() => {
    if (
      job?.status === 'completed' &&
      prevStatusRef.current &&
      prevStatusRef.current !== 'completed'
    ) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        // AudioContext not available; silently skip.
      }
    }
    prevStatusRef.current = job?.status ?? null;
  }, [job?.status]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 animate-pulse">
        <div className="h-4 w-1/3 rounded bg-neutral-800 mb-4" />
        <div className="h-2 w-full rounded bg-neutral-800" />
      </div>
    );
  }

  if (!job) return null;

  const isActive = job.status === 'queued' || job.status === 'processing';
  const isDone   = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const completedImages = images.filter(i => i.status === 'completed');
  const failedImages    = images.filter(i => i.status === 'failed');

  return (
    <div className={[
      'rounded-2xl border bg-neutral-900 overflow-hidden transition-all duration-500',
      isDone   ? 'border-green-500/30' :
      isFailed ? 'border-red-500/30'   :
                 'border-neutral-800',
    ].join(' ')}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <StatusBadge status={job.status} />
          <div>
            <p className="text-sm font-semibold text-neutral-100">
              {VIBE_LABELS[job.vibe]} Batch
            </p>
            <p className="text-xs text-neutral-500">
              {job.total_images} {job.total_images === 1 ? 'image' : 'images'}
              {' · '}
              {ASPECT_RATIO_MAP[job.ratio].label}
              {' · '}
              {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isDone && completedImages.length > 0 && (
            <DownloadAllButton jobId={job.id} imageCount={completedImages.length} />
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="rounded-lg p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {(isActive || isDone) && (
        <div className="px-5 py-3 border-b border-neutral-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-neutral-500">
              {isActive
                ? `Processing ${job.completed_count + job.failed_count + 1} of ${job.total_images}…`
                : `${completedImages.length} enhanced · ${failedImages.length} failed`}
            </span>
            <span className="text-xs font-mono font-semibold text-amber-400">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className={[
                'h-full rounded-full transition-all duration-700 ease-out',
                isDone ? 'bg-green-500' : 'bg-amber-400',
                isActive ? 'animate-pulse-subtle' : '',
              ].join(' ')}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Image Grid */}
      {images.length > 0 && (
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {images.map(img => (
              <ImageResultTile key={img.id} image={img} />
            ))}
          </div>
        </div>
      )}

      {/* Credit charge footer */}
      {isDone && (
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950/40">
          <p className="text-xs text-neutral-600">
            {job.credits_charged} credit{job.credits_charged !== 1 ? 's' : ''} used
          </p>
        </div>
      )}
    </div>
  );
}

// ── Image result tile ──────────────────────────────────────────

function ImageResultTile({ image }: { image: ProcessedImage }) {
  const isReady  = image.status === 'completed' && image.output_signed_url;
  const isFailed = image.status === 'failed';
  const isActive = image.status === 'queued' || image.status === 'processing';

  const handleDownload = async () => {
    if (!image.output_signed_url) return;
    const res = await fetch(image.output_signed_url);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomnom-${image.original_filename.replace(/\.[^.]+$/, '')}-4k.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-neutral-800">
      {/* Image */}
      {isReady && image.output_signed_url && (
        <Image
          src={image.output_signed_url}
          alt={image.original_filename}
          fill
          className="object-cover"
          sizes="100px"
          unoptimized
        />
      )}

      {/* Processing overlay */}
      {isActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900/80">
          <SpinnerIcon />
          <span className="text-[10px] font-mono text-amber-400">{image.progress_pct}%</span>
        </div>
      )}

      {/* Failed overlay */}
      {isFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/60">
          <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
          </svg>
          <span className="mt-1 text-[10px] text-red-400">Failed</span>
        </div>
      )}

      {/* Download hover overlay */}
      {isReady && (
        <button
          onClick={handleDownload}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1
                     bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={`Download ${image.original_filename}`}
        >
          <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span className="text-[10px] font-medium text-white">4K JPG</span>
        </button>
      )}

      {/* Position label */}
      <div className="absolute top-1 left-1 rounded bg-black/50 px-1 py-0.5">
        <span className="text-[9px] font-mono text-white">{image.position}</span>
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  const config: Record<JobStatus, { label: string; classes: string }> = {
    queued:     { label: 'Queued',     classes: 'bg-neutral-800 text-neutral-400' },
    processing: { label: 'Processing', classes: 'bg-amber-500/20 text-amber-400 animate-pulse' },
    completed:  { label: 'Done',       classes: 'bg-green-500/20 text-green-400' },
    failed:     { label: 'Failed',     classes: 'bg-red-500/20 text-red-400' },
    cancelled:  { label: 'Cancelled',  classes: 'bg-neutral-800 text-neutral-500' },
  };

  const { label, classes } = config[status];

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}

// ── Spinner ───────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg className="h-5 w-5 animate-spin text-amber-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
