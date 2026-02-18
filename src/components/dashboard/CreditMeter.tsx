'use client';

import type { Profile } from '@/types';
import { PLAN_LIMITS } from '@/types';

interface CreditMeterProps {
  profile: Pick<Profile, 'plan' | 'monthly_credits' | 'topup_credits' | 'credits_used_cycle'>;
}

export function CreditMeter({ profile }: CreditMeterProps) {
  const { plan, monthly_credits, topup_credits } = profile;
  const planConfig = PLAN_LIMITS[plan];
  const total = monthly_credits + topup_credits;
  const usedPct = planConfig.monthly > 0
    ? Math.min(100, Math.round((profile.credits_used_cycle / planConfig.monthly) * 100))
    : 0;

  const isLow = usedPct >= 80;
  const isDepleted = total === 0;

  return (
    <div className={[
      'rounded-2xl border p-4 space-y-3',
      isDepleted
        ? 'border-red-500/30 bg-red-950/20'
        : isLow
        ? 'border-amber-500/30 bg-amber-950/10'
        : 'border-neutral-800 bg-neutral-900/60',
    ].join(' ')}>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={[
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            plan === 'free'    ? 'bg-neutral-800 text-neutral-400' :
            plan === 'starter' ? 'bg-blue-500/20 text-blue-400' :
            plan === 'pro'     ? 'bg-purple-500/20 text-purple-400' :
                                 'bg-amber-500/20 text-amber-400',
          ].join(' ')}>
            {planConfig.label}
          </span>
          <span className="text-xs text-neutral-500">Credits</span>
        </div>

        <div className="text-right">
          <span className={`text-lg font-bold tabular-nums ${isDepleted ? 'text-red-400' : 'text-neutral-100'}`}>
            {total}
          </span>
          <span className="text-xs text-neutral-600 ml-1">remaining</span>
        </div>
      </div>

      {/* Monthly bar */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[11px] text-neutral-600">Monthly</span>
          <span className="text-[11px] text-neutral-500">
            {profile.credits_used_cycle} / {planConfig.monthly}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            className={[
              'h-full rounded-full transition-all duration-500',
              isDepleted ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-amber-500',
            ].join(' ')}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {/* Breakdown */}
      <div className="flex gap-4">
        <Stat label="Monthly" value={monthly_credits} />
        {topup_credits > 0 && <Stat label="Top-up" value={topup_credits} highlight />}
      </div>

      {/* CTA */}
      {(isDepleted || isLow) && (
        <a
          href="/billing"
          className="block w-full rounded-xl bg-amber-500 py-2 text-center text-xs font-bold text-black hover:bg-amber-400 transition-colors"
        >
          {isDepleted ? 'Buy Credits' : 'Top Up Credits'}
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-neutral-600">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${highlight ? 'text-amber-400' : 'text-neutral-300'}`}>
        {value}
      </p>
    </div>
  );
}
