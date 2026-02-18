// ============================================================
// NomNom Studio – Shared Types & Constants
// ============================================================

// ── Vibe Modes ───────────────────────────────────────────────

export type VibeMode = 'natural_light' | 'studio_light';

export const VIBE_PROMPTS: Record<VibeMode, string> = {
  natural_light:
    'High-end natural window light, soft diffused daylight, organic textures, appetizing clarity, 4k, photorealistic, neutral white balance.',
  studio_light:
    'Professional 3-point studio lighting, crisp specular highlights, deep commercial contrast, editorial style, 4k, sharp focus on food hero.',
};

export const VIBE_LABELS: Record<VibeMode, string> = {
  natural_light: 'Natural Light',
  studio_light: 'Studio Light',
};

// ── Aspect Ratios ────────────────────────────────────────────

export type AspectRatioKey =
  | 'AUTO'
  | '1:1'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '2:3'
  | '3:2';

export interface AspectRatioConfig {
  label: string;
  width: number | null;   // null = AUTO (use original)
  height: number | null;
  description: string;
  orientation: 'square' | 'portrait' | 'landscape' | 'auto';
}

export const ASPECT_RATIO_MAP: Record<AspectRatioKey, AspectRatioConfig> = {
  AUTO:  { label: 'AUTO',  width: null, height: null, description: 'Matches your upload', orientation: 'auto' },
  '1:1': { label: '1:1',   width: 3840, height: 3840, description: 'Instagram Feed',       orientation: 'square' },
  '3:4': { label: '3:4',   width: 2880, height: 3840, description: 'Portrait / Menus',     orientation: 'portrait' },
  '4:3': { label: '4:3',   width: 3840, height: 2880, description: 'Classic Landscape',    orientation: 'landscape' },
  '4:5': { label: '4:5',   width: 3072, height: 3840, description: 'Portrait / Menus',     orientation: 'portrait' },
  '5:4': { label: '5:4',   width: 3840, height: 3072, description: 'Landscape Feed',       orientation: 'landscape' },
  '9:16':{ label: '9:16',  width: 2160, height: 3840, description: 'TikTok / Reels',       orientation: 'portrait' },
  '16:9':{ label: '16:9',  width: 3840, height: 2160, description: 'YouTube / Banner',     orientation: 'landscape' },
  '2:3': { label: '2:3',   width: 2560, height: 3840, description: 'Classic Photography',  orientation: 'portrait' },
  '3:2': { label: '3:2',   width: 3840, height: 2560, description: 'Classic Photography',  orientation: 'landscape' },
};

export const ASPECT_RATIO_OPTIONS = Object.entries(ASPECT_RATIO_MAP).map(
  ([key, cfg]) => ({ key: key as AspectRatioKey, ...cfg })
);

// ── Job Status ───────────────────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

// ── Database Row Types ───────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  plan: 'free' | 'starter' | 'pro' | 'agency';
  stripe_customer_id: string | null;
  stripe_sub_id: string | null;
  sub_status: string | null;
  sub_period_end: string | null;
  monthly_credits: number;
  topup_credits: number;
  credits_used_cycle: number;
  default_vibe: VibeMode;
  default_ratio: AspectRatioKey;
  email_notifications: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcessingJob {
  id: string;
  user_id: string;
  vibe: VibeMode;
  ratio: AspectRatioKey;
  total_images: number;
  completed_count: number;
  failed_count: number;
  status: JobStatus;
  credits_charged: number;
  external_job_id: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessedImage {
  id: string;
  job_id: string;
  user_id: string;
  original_path: string;
  output_path: string | null;
  original_filename: string;
  original_width: number | null;
  original_height: number | null;
  output_width: number | null;
  output_height: number | null;
  file_size_bytes: number | null;
  status: JobStatus;
  position: number;
  progress_pct: number;
  output_signed_url: string | null;
  output_signed_url_exp: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  cta_url: string | null;
  is_read: boolean;
  job_id: string | null;
  created_at: string;
}

// ── API Payloads ─────────────────────────────────────────────

export interface StartJobPayload {
  files: File[];
  vibe: VibeMode;
  ratio: AspectRatioKey;
}

export interface StartJobResponse {
  jobId: string;
  creditsCharged: number;
}

// ── Nano Banana API ──────────────────────────────────────────

export interface NanoBananaProcessRequest {
  image_url: string;
  prompt: string;
  width?: number;
  height?: number;
  output_format: 'jpg';
  quality: number;       // 95 for 4K output
}

export interface NanoBananaProcessResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output_url?: string;
  error?: string;
  progress?: number;
}

// ── Plan Limits ──────────────────────────────────────────────

export const PLAN_LIMITS: Record<Profile['plan'], { monthly: number; label: string }> = {
  free:    { monthly: 3,   label: 'Free' },
  starter: { monthly: 20,  label: 'Starter' },
  pro:     { monthly: 100, label: 'Pro' },
  agency:  { monthly: 500, label: 'Agency' },
};

// ── Upload constraints ───────────────────────────────────────

export const MAX_FILES = 20;
export const MAX_FILE_SIZE_MB = 50;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
