'use client';

import { useState } from 'react';

interface DownloadAllButtonProps {
  jobId: string;
  imageCount: number;
}

type DownloadState = 'idle' | 'generating' | 'downloading' | 'done' | 'error';

/**
 * Downloads all enhanced images as a single ZIP.
 *
 * Strategy:
 *  1. Requests a server-side signed ZIP URL from /api/jobs/[id]/zip
 *  2. Server bundles the 4K JPGs in Supabase Storage via JSZip (Edge runtime)
 *     and stores the result in the "zips" bucket, returning a time-limited URL.
 *  3. Client performs a direct browser download from the signed URL.
 *
 * This avoids loading all large images into the client's JS heap.
 */
export function DownloadAllButton({ jobId, imageCount }: DownloadAllButtonProps) {
  const [dlState, setDlState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState(0);

  const handleClick = async () => {
    if (dlState !== 'idle' && dlState !== 'error') return;

    setDlState('generating');
    setProgress(0);

    try {
      // Poll for ZIP generation
      const res = await fetch(`/api/jobs/${jobId}/zip`, { method: 'POST' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to generate ZIP');
      }

      setProgress(60);

      const { signedUrl, filename } = await res.json();

      setDlState('downloading');
      setProgress(80);

      // Trigger browser download
      const link = document.createElement('a');
      link.href = signedUrl;
      link.download = filename ?? `nomnom-batch-${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setProgress(100);
      setDlState('done');

      // Reset after 3 s
      setTimeout(() => {
        setDlState('idle');
        setProgress(0);
      }, 3000);
    } catch (err) {
      console.error('[DownloadAll]', err);
      setDlState('error');
    }
  };

  const label: Record<DownloadState, string> = {
    idle:       `Download All (${imageCount})`,
    generating: 'Preparing ZIP…',
    downloading:'Downloading…',
    done:       'Downloaded!',
    error:      'Retry Download',
  };

  const isLoading = dlState === 'generating' || dlState === 'downloading';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={[
        'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold',
        'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
        dlState === 'done'
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : dlState === 'error'
          ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
          : isLoading
          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-wait'
          : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-95',
      ].join(' ')}
      aria-label={label[dlState]}
    >
      {isLoading ? (
        <>
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>{label[dlState]}</span>
          {progress > 0 && (
            <span className="font-mono text-xs opacity-60">{progress}%</span>
          )}
        </>
      ) : dlState === 'done' ? (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{label[dlState]}</span>
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{label[dlState]}</span>
        </>
      )}
    </button>
  );
}
