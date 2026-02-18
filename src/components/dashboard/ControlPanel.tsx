'use client';

import { VIBE_LABELS, ASPECT_RATIO_MAP, ASPECT_RATIO_OPTIONS } from '@/types';
import type { VibeMode, AspectRatioKey } from '@/types';

interface ControlPanelProps {
  vibe: VibeMode;
  onVibeChange: (v: VibeMode) => void;
  ratio: AspectRatioKey;
  onRatioChange: (r: AspectRatioKey) => void;
  disabled?: boolean;
}

export function ControlPanel({
  vibe,
  onVibeChange,
  ratio,
  onRatioChange,
  disabled,
}: ControlPanelProps) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-6">
      {/* ── Vibe Toggle ─────────────────────────────────── */}
      <div className="flex-1 space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Lighting Vibe
        </label>

        <div className="relative flex rounded-xl bg-neutral-900 border border-neutral-800 p-1">
          {/* Sliding pill */}
          <div
            className={[
              'absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-amber-500 transition-all duration-300',
              vibe === 'natural_light' ? 'left-1' : 'left-[calc(50%+2px)]',
            ].join(' ')}
            aria-hidden="true"
          />

          {(['natural_light', 'studio_light'] as VibeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => onVibeChange(mode)}
              className={[
                'relative z-10 flex-1 rounded-lg py-2.5 px-3 text-sm font-semibold transition-colors duration-200',
                vibe === mode
                  ? 'text-black'
                  : 'text-neutral-400 hover:text-neutral-200',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
              aria-pressed={vibe === mode}
            >
              <span className="flex items-center justify-center gap-2">
                {mode === 'natural_light' ? (
                  <SunIcon active={vibe === mode} />
                ) : (
                  <StudioIcon active={vibe === mode} />
                )}
                {VIBE_LABELS[mode]}
              </span>
            </button>
          ))}
        </div>

        {/* Vibe description */}
        <p className="text-[11px] text-neutral-600 leading-snug">
          {vibe === 'natural_light'
            ? 'Soft window light · organic textures · neutral white balance'
            : '3-point studio lighting · crisp highlights · commercial contrast'}
        </p>
      </div>

      {/* ── Aspect Ratio Dropdown ────────────────────────── */}
      <div className="sm:w-52 space-y-2">
        <label
          htmlFor="aspect-ratio-select"
          className="block text-xs font-semibold uppercase tracking-widest text-neutral-500"
        >
          Aspect Ratio
        </label>

        <div className="relative">
          <select
            id="aspect-ratio-select"
            value={ratio}
            onChange={(e) => onRatioChange(e.target.value as AspectRatioKey)}
            disabled={disabled}
            className={[
              'w-full appearance-none rounded-xl border border-neutral-800 bg-neutral-900',
              'px-4 py-3 pr-10 text-sm font-medium text-neutral-200',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent',
              'transition-colors hover:border-neutral-700',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ].join(' ')}
          >
            {ASPECT_RATIO_OPTIONS.map(({ key, label, description }) => (
              <option key={key} value={key}>
                {label}  —  {description}
              </option>
            ))}
          </select>

          {/* Chevron */}
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Ratio dimensions hint */}
        <p className="text-[11px] text-neutral-600">
          {ratio === 'AUTO'
            ? 'Output matches your upload dimensions'
            : `4K output: ${ASPECT_RATIO_MAP[ratio].width} × ${ASPECT_RATIO_MAP[ratio].height} px`}
        </p>
      </div>
    </div>
  );
}

// ── Icon helpers ──────────────────────────────────────────────

function SunIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${active ? 'text-black' : 'text-neutral-500'}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  );
}

function StudioIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${active ? 'text-black' : 'text-neutral-500'}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m1.636-6.364l.707.707M12 21v-1m-6.364-1.636l.707-.707M12 8a4 4 0 100 8" />
    </svg>
  );
}
