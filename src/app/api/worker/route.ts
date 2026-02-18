/**
 * /api/worker  –  Background image processing worker
 *
 * Triggered by /api/process after a job is created.
 * Processes each image through the Nano Banana API,
 * then stores the 4K output in Supabase Storage.
 *
 * In production you should use a proper job queue (Inngest,
 * Trigger.dev, Supabase pg_cron + Edge Functions, or AWS SQS)
 * rather than a long-running API route.
 *
 * Vercel: set maxDuration = 300 in vercel.json for this route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { VIBE_PROMPTS, ASPECT_RATIO_MAP } from '@/types';
import type { VibeMode, AspectRatioKey, ProcessedImage, ProcessingJob } from '@/types';

const NANO_BANANA_API_URL = 'https://api.nanobanana.io/v1/transform';
const NANO_BANANA_API_KEY = process.env.NANO_BANANA_API_KEY ?? '';
const WORKER_SECRET       = process.env.WORKER_SECRET ?? '';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Auth guard ────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('X-Worker-Secret');
  return secret === WORKER_SECRET;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body   = await req.json();
  const jobId  = body?.jobId as string;
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const db = adminClient();

  // ── Load job ───────────────────────────────────────────────
  const { data: job } = await db
    .from('processing_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // ── Mark processing ────────────────────────────────────────
  await db.from('processing_jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', jobId);

  // ── Load images ────────────────────────────────────────────
  const { data: images } = await db
    .from('processed_images')
    .select('*')
    .eq('job_id', jobId)
    .order('position');

  if (!images?.length) {
    await db.from('processing_jobs').update({ status: 'failed', error_message: 'No images found' }).eq('id', jobId);
    return NextResponse.json({ error: 'No images' }, { status: 400 });
  }

  // ── Get ratio config ───────────────────────────────────────
  const typedJob = job as ProcessingJob;
  const ratioKey  = typedJob.ratio as AspectRatioKey;
  const ratioConf = ASPECT_RATIO_MAP[ratioKey];
  const prompt    = VIBE_PROMPTS[typedJob.vibe as VibeMode];

  // ── Process each image ─────────────────────────────────────
  for (const img of images as ProcessedImage[]) {
    await processImage({ db, img, job: typedJob, ratioConf, prompt });
  }

  // ── Send in-app notification ───────────────────────────────
  const { data: finalJob } = await db
    .from('processing_jobs')
    .select('completed_count, failed_count, total_images')
    .eq('id', jobId)
    .single();

  const completedCount = finalJob?.completed_count ?? 0;
  const failedCount    = finalJob?.failed_count    ?? 0;

  await db.from('notifications').insert({
    user_id: typedJob.user_id,
    type:    completedCount > 0 ? 'job_completed' : 'job_failed',
    title:   completedCount > 0
      ? `${completedCount} photo${completedCount > 1 ? 's' : ''} enhanced! ✨`
      : 'Enhancement failed',
    body:    failedCount > 0
      ? `${failedCount} image${failedCount > 1 ? 's' : ''} could not be processed.`
      : null,
    cta_url: `/dashboard`,
    job_id:  jobId,
  });

  // ── Send email notification (if enabled) ──────────────────
  if (completedCount > 0) {
    await sendCompletionEmail(db, typedJob.user_id, completedCount, jobId).catch(
      err => console.error('[worker] email send failed:', err)
    );
  }

  return NextResponse.json({ ok: true, completed: completedCount, failed: failedCount });
}

// ── Process single image ──────────────────────────────────────

async function processImage({
  db,
  img,
  job,
  ratioConf,
  prompt,
}: {
  db: ReturnType<typeof adminClient>;
  img: ProcessedImage;
  job: ProcessingJob;
  ratioConf: typeof ASPECT_RATIO_MAP[AspectRatioKey];
  prompt: string;
}) {
  try {
    // Mark as processing
    await db.from('processed_images').update({ status: 'processing', progress_pct: 5 }).eq('id', img.id);

    // Generate signed URL for the uploaded original (valid 10 min for Nano Banana to fetch)
    const { data: signedData, error: signErr } = await db.storage
      .from('uploads')
      .createSignedUrl(img.original_path, 600);

    if (signErr || !signedData?.signedUrl) throw new Error('Could not sign original URL');

    await db.from('processed_images').update({ progress_pct: 15 }).eq('id', img.id);

    // ── Call Nano Banana API ─────────────────────────────────
    const nanoBananaPayload: Record<string, unknown> = {
      image_url:     signedData.signedUrl,
      prompt,
      output_format: 'jpg',
      quality:       95,
    };

    // Only pass explicit dimensions if not AUTO
    if (ratioConf.width && ratioConf.height) {
      nanoBananaPayload.width  = ratioConf.width;
      nanoBananaPayload.height = ratioConf.height;
      nanoBananaPayload.fit    = 'cover';  // crop to fill target canvas
    }

    const nbRes = await fetch(NANO_BANANA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NANO_BANANA_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(nanoBananaPayload),
    });

    if (!nbRes.ok) {
      const errText = await nbRes.text();
      throw new Error(`Nano Banana API error ${nbRes.status}: ${errText}`);
    }

    await db.from('processed_images').update({ progress_pct: 40 }).eq('id', img.id);

    // ── Poll for completion ────────────────────────────────
    //    Nano Banana returns an async job ID; poll until done.
    const nbData = await nbRes.json();
    const outputUrl = await pollNanoBanana(nbData.id, img, db);

    await db.from('processed_images').update({ progress_pct: 75 }).eq('id', img.id);

    // ── Download output and store in Supabase ─────────────
    const outputRes  = await fetch(outputUrl);
    if (!outputRes.ok) throw new Error('Failed to fetch Nano Banana output');

    const outputBuf  = await outputRes.arrayBuffer();
    const outputPath = `outputs/${job.user_id}/${job.id}/enhanced_${img.position}.jpg`;

    const { error: storeErr } = await db.storage
      .from('outputs')
      .upload(outputPath, outputBuf, { contentType: 'image/jpeg', upsert: false });

    if (storeErr) throw new Error(`Storage upload failed: ${storeErr.message}`);

    // ── Generate signed URL for download (valid 24 h) ─────
    const { data: dlSigned } = await db.storage
      .from('outputs')
      .createSignedUrl(outputPath, 86400);

    await db.from('processed_images').update({
      status:               'completed',
      progress_pct:         100,
      output_path:          outputPath,
      file_size_bytes:      outputBuf.byteLength,
      output_signed_url:    dlSigned?.signedUrl ?? null,
      output_signed_url_exp: new Date(Date.now() + 86400 * 1000).toISOString(),
    }).eq('id', img.id);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] image ${img.id} failed:`, message);
    await db.from('processed_images').update({
      status:        'failed',
      error_message: message,
    }).eq('id', img.id);
  }
}

// ── Polling helper ────────────────────────────────────────────

async function pollNanoBanana(
  externalId: string,
  img: ProcessedImage,
  db: ReturnType<typeof adminClient>,
  maxAttempts = 60,   // 60 × 5s = 5 min timeout
  intervalMs  = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    const res = await fetch(`${NANO_BANANA_API_URL}/${externalId}`, {
      headers: { 'Authorization': `Bearer ${NANO_BANANA_API_KEY}` },
    });

    if (!res.ok) continue;

    const data = await res.json();

    // Update progress in DB
    const progressPct = 40 + Math.round((data.progress ?? i / maxAttempts * 100) * 0.35);
    await db.from('processed_images').update({ progress_pct: Math.min(74, progressPct) }).eq('id', img.id);

    if (data.status === 'completed' && data.output_url) {
      return data.output_url;
    }
    if (data.status === 'failed') {
      throw new Error(data.error ?? 'Nano Banana processing failed');
    }
  }

  throw new Error('Nano Banana processing timed out');
}

// ── Email notification ─────────────────────────────────────────

async function sendCompletionEmail(
  db: ReturnType<typeof adminClient>,
  userId: string,
  count: number,
  jobId: string
) {
  const { data: profile } = await db
    .from('profiles')
    .select('email, full_name, email_notifications')
    .eq('id', userId)
    .single();

  if (!profile?.email_notifications) return;

  // Use Supabase's built-in SMTP or swap in Resend/SendGrid
  // This is a stub – wire up your preferred email provider here.
  const emailPayload = {
    to:      profile.email,
    subject: `Your ${count} NomNom ${count === 1 ? 'photo is' : 'photos are'} ready! 🍽✨`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f5f5f5;border-radius:16px;">
        <h1 style="color:#f59e0b;font-size:24px;margin-bottom:8px;">Your photos are ready!</h1>
        <p style="color:#a3a3a3;font-size:15px;line-height:1.6;">
          Hi ${profile.full_name ?? 'Chef'}, your ${count} enhanced 4K food
          ${count === 1 ? 'photo has' : 'photos have'} been processed and are ready to download.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
           style="display:inline-block;margin-top:24px;padding:12px 24px;
                  background:#f59e0b;color:#000;font-weight:700;
                  border-radius:12px;text-decoration:none;font-size:14px;">
          View &amp; Download →
        </a>
        <p style="color:#525252;font-size:12px;margin-top:32px;">
          NomNom Studio · AI Food Photography
        </p>
      </div>
    `,
  };

  console.info('[worker] email queued for:', profile.email, '| payload:', JSON.stringify(emailPayload));
  // await yourEmailProvider.send(emailPayload);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
