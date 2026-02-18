/**
 * POST /api/jobs/[id]/zip
 *
 * Server-side ZIP bundler for "Download All".
 *
 * Strategy:
 *  1. Load all completed images for the job from Supabase Storage.
 *  2. Bundle them with JSZip in memory (Edge-safe via streaming).
 *  3. Upload the resulting ZIP to the "zips" bucket.
 *  4. Return a 1-hour signed URL.
 *
 * If a cached bundle exists and its signed URL hasn't expired, return it
 * immediately without re-zipping.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient }       from '@supabase/supabase-js';
import { cookies }            from 'next/headers';
import JSZip                  from 'jszip';

// ── Supabase clients ──────────────────────────────────────────

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

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ────────────────────────────────────────────────────
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: jobId } = await params;
  const db = adminClient();

  // ── Verify job ownership ────────────────────────────────────
  const { data: job } = await db
    .from('processing_jobs')
    .select('id, user_id, status')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.status !== 'completed') {
    return NextResponse.json({ error: 'Job not yet completed' }, { status: 409 });
  }

  // ── Check for cached bundle ─────────────────────────────────
  const { data: existing } = await db
    .from('zip_bundles')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (existing?.signed_url && existing.signed_url_exp) {
    const expiry = new Date(existing.signed_url_exp).getTime();
    if (expiry > Date.now() + 60_000) {
      // Still valid for at least 1 more minute
      return NextResponse.json({
        signedUrl: existing.signed_url,
        filename:  `nomnom-batch-${jobId.slice(0, 8)}.zip`,
      });
    }
  }

  // ── Load completed images ────────────────────────────────────
  const { data: images } = await db
    .from('processed_images')
    .select('id, output_path, original_filename, position')
    .eq('job_id', jobId)
    .eq('status', 'completed')
    .order('position');

  if (!images?.length) {
    return NextResponse.json({ error: 'No completed images found' }, { status: 404 });
  }

  // ── Build ZIP ────────────────────────────────────────────────
  const zip = new JSZip();
  const folder = zip.folder('NomNom-Studio-4K')!;

  // Download all output images in parallel (batched to avoid overloading)
  const BATCH_SIZE = 5;
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (img) => {
        // Generate a short-lived signed URL for storage access
        const { data: signed } = await db.storage
          .from('outputs')
          .createSignedUrl(img.output_path, 300); // 5 min – enough to download

        if (!signed?.signedUrl) return;

        const res = await fetch(signed.signedUrl);
        if (!res.ok) return;

        const buf  = await res.arrayBuffer();
        const name = `${String(img.position).padStart(2, '0')}_nomnom_${img.original_filename.replace(/\.[^.]+$/, '')}_4k.jpg`;
        folder.file(name, buf);
      })
    );
  }

  // ── Generate ZIP buffer ───────────────────────────────────────
  const zipBuffer = await zip.generateAsync({
    type:               'arraybuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // ── Upload to Supabase Storage ────────────────────────────────
  const zipPath = `zips/${user.id}/${jobId}/bundle.zip`;

  await db.storage.from('zips').remove([zipPath]).catch(() => {}); // remove stale

  const { error: uploadErr } = await db.storage
    .from('zips')
    .upload(zipPath, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json({ error: 'Failed to store ZIP' }, { status: 500 });
  }

  // ── Create signed download URL (1 hour) ───────────────────────
  const { data: signedData } = await db.storage
    .from('zips')
    .createSignedUrl(zipPath, 3600);

  if (!signedData?.signedUrl) {
    return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 });
  }

  const signedUrlExp = new Date(Date.now() + 3600 * 1000).toISOString();

  // ── Persist bundle record (upsert) ────────────────────────────
  await db.from('zip_bundles').upsert({
    job_id:          jobId,
    user_id:         user.id,
    storage_path:    zipPath,
    signed_url:      signedData.signedUrl,
    signed_url_exp:  signedUrlExp,
    file_size_bytes: zipBuffer.byteLength,
    image_count:     images.length,
  }, { onConflict: 'job_id' });

  return NextResponse.json({
    signedUrl: signedData.signedUrl,
    filename:  `nomnom-batch-${jobId.slice(0, 8)}.zip`,
  });
}
