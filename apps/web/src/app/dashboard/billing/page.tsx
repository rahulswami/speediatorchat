'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Subscription = {
  plan: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
};

type UsageData = {
  plan: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
};

const PLAN_LABELS: Record<string, string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
};

const STATUS_COLORS: Record<string, string> = {
  TRIALING: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAST_DUE: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/billing/subscription').then((r) => r.json()),
      fetch('/api/billing/usage').then((r) => r.json()),
    ])
      .then(([s, u]) => {
        setSub(s);
        setUsage(u);
      })
      .finally(() => setLoading(false));
  }, []);

  async function upgrade(plan: string) {
    setUpgrading(true);
    await fetch('/api/billing/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const s = await fetch('/api/billing/subscription').then((r) => r.json());
    setSub(s);
    setUpgrading(false);
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">Billing</h1>

      {sub && (
        <div className="border rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="text-lg font-semibold mt-1">{PLAN_LABELS[sub.plan] ?? sub.plan}</p>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[sub.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {sub.status}
            </span>
          </div>
          {sub.trialEndsAt && (
            <p className="text-sm text-muted-foreground mt-3">
              Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
            </p>
          )}
          {sub.currentPeriodEnd && sub.status === 'ACTIVE' && (
            <p className="text-sm text-muted-foreground mt-3">
              Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {usage && (
        <div className="border rounded-lg p-5 mb-6">
          <h2 className="text-sm font-medium mb-4">Usage this period</h2>
          <div className="space-y-3">
            {Object.entries(usage.limits).map(([metric, limit]) => {
              const used = usage.usage[metric] ?? 0;
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={metric}>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span className="capitalize">{metric}</span>
                    <span>{used} / {limit}</span>
                  </div>
                  <div className="bg-muted rounded-full h-1.5">
                    <div
                      className={`rounded-full h-1.5 transition-all ${pct >= 90 ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sub?.plan !== 'SCALE' && (
        <div className="border rounded-lg p-5">
          <h2 className="text-sm font-medium mb-4">Upgrade plan</h2>
          <div className="grid grid-cols-2 gap-3">
            {sub?.plan === 'STARTER' && (
              <div className="border rounded p-4">
                <p className="font-medium">Growth</p>
                <p className="text-sm text-muted-foreground mt-1">5,000 contacts · 50 campaigns · 5 agents</p>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => upgrade('GROWTH')}
                  disabled={upgrading}
                >
                  Upgrade to Growth
                </Button>
              </div>
            )}
            <div className="border rounded p-4">
              <p className="font-medium">Scale</p>
              <p className="text-sm text-muted-foreground mt-1">Unlimited contacts · unlimited campaigns</p>
              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={() => upgrade('SCALE')}
                disabled={upgrading}
              >
                Upgrade to Scale
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
