import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';
import type { Profile, ProcessingJob } from '@/types';

// Never statically pre-render — this page requires auth + Supabase cookies at runtime
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard — NomNom Studio',
  description: 'Transform your food photos into 4K studio masterpieces.',
};

export default async function DashboardPage() {
  const supabase = await createClient();

  // ── Auth guard ─────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // ── Load profile ───────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) redirect('/login');

  // ── Load recent jobs (last 10) ─────────────────────────────
  const { data: recentJobs } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <DashboardClient
      profile={profile as Profile}
      initialJobs={(recentJobs ?? []) as ProcessingJob[]}
    />
  );
}
