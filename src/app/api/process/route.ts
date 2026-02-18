import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  VIBE_PROMPTS,
  ASPECT_RATIO_MAP,
  MAX_FILES,
  MAX_FILE_SIZE_MB,
  ACCEPTED_TYPES,
} from '@/types';
import type { VibeMode, AspectRatioKey } from '@/types';

// ── Supabase admin client (bypasses RLS for trusted server ops) ──
function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Auth-aware client (respects RLS) ──
async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  );
}

export async function POST(req: NextRequest) {
  // ── 1. Authenticate ────────────────────────────────────────
  const supabase = await createAuthClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse form data ─────────────────────────────────────
  const form = await req.formData();
  const files     = form.getAll('files') as File[];
  const vibe      = (form.get('vibe') as VibeMode) ?? 'natural_light';
  const ratio     = (form.get('ratio') as AspectRatioKey) ?? 'AUTO';

  // ── 3. Validate ────────────────────────────────────────────
  if (!files.length || files.length > MAX_FILES) {
    return NextResponse.json({ error: `Submit between 1 and ${MAX_FILES} images.` }, { status: 400 });
  }

  for (const file of files) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `${file.name} exceeds ${MAX_FILE_SIZE_MB} MB.` }, { status: 400 });
    }
  }

  if (!Object.keys(VIBE_PROMPTS).includes(vibe)) {
    return NextResponse.json({ error: 'Invalid vibe.' }, { status: 400 });
  }
  if (!Object.keys(ASPECT_RATIO_MAP).includes(ratio)) {
    return NextResponse.json({ error: 'Invalid aspect ratio.' }, { status: 400 });
  }

  // ── 4. Check credits ───────────────────────────────────────
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('monthly_credits, topup_credits')
    .eq('id', user.id)
    .single();

  const available = (profile?.monthly_credits ?? 0) + (profile?.topup_credits ?? 0);
  if (available < files.length) {
    return NextResponse.json(
      { error: `Insufficient credits. You have ${available}, need ${files.length}.` },
      { status: 402 }
    );
  }

  // ── 5. Deduct credits ──────────────────────────────────────
  const { data: deducted } = await admin.rpc('deduct_credits', {
    p_user_id: user.id,
    p_amount: files.length,
  });
  if (!deducted) {
    return NextResponse.json({ error: 'Credit deduction failed.' }, { status: 402 });
  }

  // ── 6. Create job record ───────────────────────────────────
  const { data: job, error: jobErr } = await admin
    .from('processing_jobs')
    .insert({
      user_id:       user.id,
      vibe,
      ratio,
      total_images:  files.length,
      credits_charged: files.length,
      status:        'queued',
    })
    .select()
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Failed to create job.' }, { status: 500 });
  }

  // ── 7. Upload originals to Supabase Storage ────────────────
  const uploadResults = await Promise.all(
    files.map(async (file, i) => {
      const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `uploads/${user.id}/${job.id}/original_${i + 1}.${ext}`;
      const buf  = await file.arrayBuffer();

      const { error: upErr } = await admin.storage
        .from('uploads')
        .upload(path, buf, {
          contentType: file.type,
          upsert: false,
        });

      return { path, filename: file.name, error: upErr, position: i + 1 };
    })
  );

  const failedUploads = uploadResults.filter(r => r.error);
  if (failedUploads.length === files.length) {
    // All uploads failed – clean up and refund
    await admin.from('processing_jobs').update({ status: 'failed' }).eq('id', job.id);
    return NextResponse.json({ error: 'All uploads failed. Credits refunded.' }, { status: 500 });
  }

  // ── 8. Insert processed_images rows ───────────────────────
  const successUploads = uploadResults.filter(r => !r.error);

  await admin.from('processed_images').insert(
    successUploads.map(u => ({
      job_id:            job.id,
      user_id:           user.id,
      original_path:     u.path,
      original_filename: u.filename,
      status:            'queued',
      position:          u.position,
    }))
  );

  // Update total if some uploads failed
  if (failedUploads.length > 0) {
    await admin
      .from('processing_jobs')
      .update({ total_images: successUploads.length })
      .eq('id', job.id);
  }

  // ── 9. Dispatch to background worker ──────────────────────
  //
  // Fire-and-forget: call our own /api/worker with the job id.
  // In production, replace this with a proper queue (e.g. Inngest,
  // Trigger.dev, or a Supabase Edge Function cron).
  //
  const workerUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/worker`;
  fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Worker-Secret': process.env.WORKER_SECRET ?? '',
    },
    body: JSON.stringify({ jobId: job.id }),
  }).catch(err => console.error('[process] worker dispatch failed:', err));

  return NextResponse.json({ jobId: job.id, creditsCharged: successUploads.length });
}
