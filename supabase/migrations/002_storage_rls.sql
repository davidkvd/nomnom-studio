-- ============================================================
-- NomNom Studio – Storage Bucket RLS Policies
-- Run after creating the buckets in Supabase Dashboard
-- ============================================================

-- ── uploads bucket ───────────────────────────────────────────

CREATE POLICY "uploads_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "uploads_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "uploads_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'uploads' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── outputs bucket ───────────────────────────────────────────

CREATE POLICY "outputs_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'outputs' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Service role handles inserts via admin client (no user policy needed)

-- ── zips bucket ──────────────────────────────────────────────

CREATE POLICY "zips_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'zips' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
