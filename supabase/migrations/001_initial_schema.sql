-- ============================================================
-- NomNom Studio – Complete Database Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";      -- for job cleanup (optional)
CREATE EXTENSION IF NOT EXISTS "pg_net";        -- for outbound webhooks (optional)

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE vibe_mode AS ENUM ('natural_light', 'studio_light');

CREATE TYPE aspect_ratio AS ENUM (
  'AUTO',
  '1:1',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '2:3',
  '3:2'
);

CREATE TYPE job_status AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE plan_type AS ENUM (
  'free',
  'starter',        -- 20 images/month
  'pro',            -- 100 images/month
  'agency'          -- 500 images/month
);

CREATE TYPE notification_type AS ENUM (
  'job_completed',
  'job_failed',
  'credits_low',
  'credits_depleted',
  'subscription_renewed',
  'subscription_cancelled',
  'churn_discount_offered'
);

-- ============================================================
-- PROFILES  (extends Supabase auth.users)
-- ============================================================

CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  full_name           TEXT,
  avatar_url          TEXT,

  -- Subscription state (mirrors Stripe)
  plan                plan_type NOT NULL DEFAULT 'free',
  stripe_customer_id  TEXT UNIQUE,
  stripe_sub_id       TEXT UNIQUE,
  sub_status          TEXT,                          -- active | trialing | past_due | canceled
  sub_period_end      TIMESTAMPTZ,

  -- Credit wallet
  monthly_credits     INT NOT NULL DEFAULT 0,        -- resets each billing cycle
  topup_credits       INT NOT NULL DEFAULT 0,        -- never expire
  credits_used_cycle  INT NOT NULL DEFAULT 0,        -- usage tracking for current cycle

  -- Churn prevention
  churn_discount_offered_at  TIMESTAMPTZ,
  churn_discount_accepted    BOOLEAN DEFAULT FALSE,

  -- Preferences
  default_vibe        vibe_mode DEFAULT 'natural_light',
  default_ratio       aspect_ratio DEFAULT 'AUTO',
  email_notifications BOOLEAN DEFAULT TRUE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CREDIT TRANSACTIONS  (full audit trail)
-- ============================================================

CREATE TABLE credit_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  amount        INT NOT NULL,   -- positive = credit, negative = debit
  balance_after INT NOT NULL,
  source        TEXT NOT NULL,  -- 'monthly_grant' | 'topup_purchase' | 'job_charge' | 'refund' | 'churn_bonus'
  reference_id  TEXT,           -- stripe payment intent or job id

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROCESSING JOBS  (one per batch submission)
-- ============================================================

CREATE TABLE processing_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Configuration
  vibe            vibe_mode NOT NULL,
  ratio           aspect_ratio NOT NULL DEFAULT 'AUTO',

  -- Counters (denormalized for fast polling)
  total_images    INT NOT NULL CHECK (total_images BETWEEN 1 AND 20),
  completed_count INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,

  -- State
  status          job_status NOT NULL DEFAULT 'queued',
  credits_charged INT NOT NULL DEFAULT 0,

  -- External reference (Nano Banana)
  external_job_id TEXT,

  -- Timing
  queued_at       TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  -- Error capture
  error_message   TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROCESSED IMAGES  (one row per image within a job)
-- ============================================================

CREATE TABLE processed_images (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Storage paths (Supabase Storage)
  original_path     TEXT NOT NULL,    -- uploads/{user_id}/{job_id}/original_{n}.jpg
  output_path       TEXT,             -- outputs/{user_id}/{job_id}/enhanced_{n}.jpg

  -- Image metadata
  original_filename TEXT NOT NULL,
  original_width    INT,
  original_height   INT,
  output_width      INT,
  output_height     INT,
  file_size_bytes   BIGINT,           -- output file size

  -- Processing state
  status            job_status NOT NULL DEFAULT 'queued',
  position          INT NOT NULL,     -- order within the batch (1-based)
  progress_pct      SMALLINT DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),

  -- External reference
  external_image_id TEXT,

  -- Signed URL cache (regenerated on demand, 1h TTL)
  output_signed_url       TEXT,
  output_signed_url_exp   TIMESTAMPTZ,

  -- Error detail
  error_message     TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ZIP BUNDLES  (pre-signed download bundles for "Download All")
-- ============================================================

CREATE TABLE zip_bundles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  storage_path  TEXT NOT NULL,         -- zips/{user_id}/{job_id}/bundle.zip
  signed_url    TEXT,
  signed_url_exp TIMESTAMPTZ,

  file_size_bytes BIGINT,
  image_count   INT NOT NULL,

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS  (in-app notification feed)
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  cta_url     TEXT,              -- e.g. "/dashboard/jobs/{job_id}"
  is_read     BOOLEAN DEFAULT FALSE,

  -- Contextual references
  job_id      UUID REFERENCES processing_jobs(id) ON DELETE SET NULL,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STRIPE EVENTS  (idempotency log for webhook replays)
-- ============================================================

CREATE TABLE stripe_events (
  id            TEXT PRIMARY KEY,    -- Stripe event id (evt_xxx)
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Profiles
CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Jobs
CREATE INDEX idx_jobs_user_id       ON processing_jobs(user_id, created_at DESC);
CREATE INDEX idx_jobs_status        ON processing_jobs(status) WHERE status IN ('queued','processing');
CREATE INDEX idx_jobs_external      ON processing_jobs(external_job_id) WHERE external_job_id IS NOT NULL;

-- Images
CREATE INDEX idx_images_job_id      ON processed_images(job_id, position);
CREATE INDEX idx_images_user_id     ON processed_images(user_id, created_at DESC);
CREATE INDEX idx_images_status      ON processed_images(status) WHERE status IN ('queued','processing');

-- Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- Credit transactions
CREATE INDEX idx_credits_user       ON credit_transactions(user_id, created_at DESC);

-- ============================================================
-- TRIGGERS – auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_images_updated_at
  BEFORE UPDATE ON processed_images
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER – sync job status when all images finish
-- ============================================================

CREATE OR REPLACE FUNCTION sync_job_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_total     INT;
  v_completed INT;
  v_failed    INT;
BEGIN
  SELECT total_images, completed_count, failed_count
    INTO v_total, v_completed, v_failed
    FROM processing_jobs
   WHERE id = NEW.job_id;

  IF NEW.status = 'completed' THEN
    UPDATE processing_jobs
       SET completed_count = completed_count + 1,
           status = CASE
             WHEN (completed_count + 1 + v_failed) = v_total THEN 'completed'
             ELSE status
           END,
           completed_at = CASE
             WHEN (completed_count + 1 + v_failed) = v_total THEN NOW()
             ELSE completed_at
           END
     WHERE id = NEW.job_id;
  END IF;

  IF NEW.status = 'failed' THEN
    UPDATE processing_jobs
       SET failed_count = failed_count + 1,
           status = CASE
             WHEN (v_completed + failed_count + 1) = v_total THEN 'completed'
             ELSE status
           END,
           completed_at = CASE
             WHEN (v_completed + failed_count + 1) = v_total THEN NOW()
             ELSE completed_at
           END
     WHERE id = NEW.job_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_job_on_image_complete
  AFTER UPDATE OF status ON processed_images
  FOR EACH ROW
  WHEN (NEW.status IN ('completed','failed') AND OLD.status NOT IN ('completed','failed'))
  EXECUTE FUNCTION sync_job_completion();

-- ============================================================
-- TRIGGER – create profile on auth.users insert
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_bundles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update only their own row
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Credits: read own
CREATE POLICY "credits_select_own" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);

-- Jobs: full CRUD on own rows
CREATE POLICY "jobs_select_own"  ON processing_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jobs_insert_own"  ON processing_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jobs_update_own"  ON processing_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jobs_delete_own"  ON processing_jobs FOR DELETE USING (auth.uid() = user_id);

-- Images: full CRUD on own rows
CREATE POLICY "images_select_own"  ON processed_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "images_insert_own"  ON processed_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "images_update_own"  ON processed_images FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "images_delete_own"  ON processed_images FOR DELETE USING (auth.uid() = user_id);

-- Zips
CREATE POLICY "zips_select_own" ON zip_bundles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "zips_insert_own" ON zip_bundles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Notifications
CREATE POLICY "notifs_select_own" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_update_own" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKETS (run in Supabase Dashboard > Storage)
-- ============================================================
-- NOTE: Create these buckets manually or via Supabase CLI:
--
--  supabase storage create uploads  --public=false --file-size-limit=52428800  (50MB per file)
--  supabase storage create outputs  --public=false --file-size-limit=209715200 (200MB per 4K JPG)
--  supabase storage create zips     --public=false --file-size-limit=2147483648 (2GB)
--
-- Storage RLS (applied via Dashboard or separate migration):
--  Users can only read/write their own paths: uploads/{user_id}/**
--                                             outputs/{user_id}/**
--                                             zips/{user_id}/**

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Compute total available credits for a user
CREATE OR REPLACE FUNCTION get_available_credits(p_user_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT monthly_credits + topup_credits
    FROM profiles
   WHERE id = p_user_id;
$$;

-- Deduct credits (monthly first, then top-up)
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_monthly INT;
  v_topup   INT;
  v_deduct_monthly INT;
  v_deduct_topup   INT;
  v_balance_after  INT;
BEGIN
  SELECT monthly_credits, topup_credits
    INTO v_monthly, v_topup
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF (v_monthly + v_topup) < p_amount THEN
    RETURN FALSE;
  END IF;

  v_deduct_monthly := LEAST(p_amount, v_monthly);
  v_deduct_topup   := p_amount - v_deduct_monthly;

  UPDATE profiles
     SET monthly_credits    = monthly_credits - v_deduct_monthly,
         topup_credits      = topup_credits   - v_deduct_topup,
         credits_used_cycle = credits_used_cycle + p_amount
   WHERE id = p_user_id;

  v_balance_after := (v_monthly - v_deduct_monthly) + (v_topup - v_deduct_topup);

  INSERT INTO credit_transactions (user_id, amount, balance_after, source)
  VALUES (p_user_id, -p_amount, v_balance_after, 'job_charge');

  RETURN TRUE;
END;
$$;

-- Mark notifications as read (bulk)
CREATE OR REPLACE FUNCTION mark_notifications_read(p_user_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE notifications SET is_read = TRUE
   WHERE user_id = p_user_id AND is_read = FALSE;
$$;
