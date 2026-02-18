'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ProcessingJob, ProcessedImage } from '@/types';

export interface JobProgressState {
  job: ProcessingJob | null;
  images: ProcessedImage[];
  progressPct: number;   // 0–100, overall
  isLoading: boolean;
  error: string | null;
}

/**
 * Subscribes to real-time updates for a single processing job
 * using Supabase Realtime (postgres_changes).
 */
export function useJobProgress(jobId: string | null): JobProgressState {
  const supabase = createClient();

  const [state, setState] = useState<JobProgressState>({
    job: null,
    images: [],
    progressPct: 0,
    isLoading: true,
    error: null,
  });

  // ── Initial fetch ──────────────────────────────────────────
  const fetchSnapshot = useCallback(async () => {
    if (!jobId) return;

    const [jobRes, imagesRes] = await Promise.all([
      supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', jobId)
        .single(),
      supabase
        .from('processed_images')
        .select('*')
        .eq('job_id', jobId)
        .order('position'),
    ]);

    if (jobRes.error || imagesRes.error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: jobRes.error?.message ?? imagesRes.error?.message ?? 'Unknown error',
      }));
      return;
    }

    const job = jobRes.data as ProcessingJob;
    const images = imagesRes.data as ProcessedImage[];
    const progressPct = computeProgress(job, images);

    setState({ job, images, progressPct, isLoading: false, error: null });
  }, [jobId]);

  // ── Subscribe to realtime changes ──────────────────────────
  useEffect(() => {
    if (!jobId) return;

    fetchSnapshot();

    const channel = supabase
      .channel(`job:${jobId}`)
      // Job-level updates (status, counts)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'processing_jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          setState(prev => {
            const job = payload.new as ProcessingJob;
            const progressPct = computeProgress(job, prev.images);
            return { ...prev, job, progressPct };
          });
        }
      )
      // Image-level updates (per-image progress)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'processed_images',
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          setState(prev => {
            let images: ProcessedImage[];

            if (payload.eventType === 'INSERT') {
              images = [...prev.images, payload.new as ProcessedImage].sort(
                (a, b) => a.position - b.position
              );
            } else if (payload.eventType === 'UPDATE') {
              images = prev.images.map(img =>
                img.id === payload.new.id ? (payload.new as ProcessedImage) : img
              );
            } else {
              images = prev.images;
            }

            const progressPct = computeProgress(prev.job, images);
            return { ...prev, images, progressPct };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, fetchSnapshot]);

  return state;
}

// ── Helpers ────────────────────────────────────────────────────

function computeProgress(job: ProcessingJob | null, images: ProcessedImage[]): number {
  if (!job) return 0;
  if (job.status === 'completed') return 100;
  if (job.status === 'queued') return 0;
  if (images.length === 0) return 5; // show minimal activity

  const total = images.length;
  const sumPct = images.reduce((acc, img) => {
    if (img.status === 'completed') return acc + 100;
    if (img.status === 'failed')    return acc + 100;
    return acc + (img.progress_pct ?? 0);
  }, 0);

  return Math.round(sumPct / total);
}
