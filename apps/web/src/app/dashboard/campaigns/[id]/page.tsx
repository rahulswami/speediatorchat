'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Pause } from 'lucide-react';
import Link from 'next/link';

type Campaign = {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
};

type Analytics = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/campaigns/${id}`).then((r) => r.json()),
      fetch(`/api/campaigns/${id}/analytics`).then((r) => r.json()),
    ])
      .then(([c, a]) => {
        setCampaign(c);
        setAnalytics(a);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function launch() {
    setActionLoading(true);
    const res = await fetch(`/api/campaigns/${id}/launch`, { method: 'POST' });
    if (res.ok) {
      const updated = await fetch(`/api/campaigns/${id}`).then((r) => r.json());
      setCampaign(updated);
    }
    setActionLoading(false);
  }

  async function pause() {
    setActionLoading(true);
    const res = await fetch(`/api/campaigns/${id}/pause`, { method: 'POST' });
    if (res.ok) {
      const updated = await fetch(`/api/campaigns/${id}`).then((r) => r.json());
      setCampaign(updated);
    }
    setActionLoading(false);
  }

  async function remove() {
    if (!confirm('Delete this campaign?')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    router.push('/dashboard/campaigns');
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!campaign) return <div className="p-6 text-sm text-muted-foreground">Campaign not found.</div>;

  const deliveryRate = analytics && analytics.total > 0
    ? Math.round((analytics.delivered / analytics.total) * 100)
    : 0;

  return (
    <div className="p-6">
      <Link href="/dashboard/campaigns" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3 h-3" /> Campaigns
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {campaign.status}
            </span>
            <span className="text-xs text-muted-foreground">
              Created {new Date(campaign.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === 'DRAFT' && (
            <Button size="sm" className="gap-1" onClick={launch} disabled={actionLoading}>
              <Play className="w-3 h-3" /> Launch
            </Button>
          )}
          {campaign.status === 'RUNNING' && (
            <Button size="sm" variant="outline" className="gap-1" onClick={pause} disabled={actionLoading}>
              <Pause className="w-3 h-3" /> Pause
            </Button>
          )}
          {['DRAFT', 'PAUSED', 'COMPLETED'].includes(campaign.status) && (
            <Button size="sm" variant="destructive" onClick={remove}>Delete</Button>
          )}
        </div>
      </div>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total', value: analytics.total },
            { label: 'Sent', value: analytics.sent },
            { label: 'Delivered', value: analytics.delivered },
            { label: 'Read', value: analytics.read },
          ].map(({ label, value }) => (
            <div key={label} className="border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      {analytics && analytics.total > 0 && (
        <div className="border rounded-lg p-4 max-w-sm">
          <p className="text-xs text-muted-foreground mb-2">Delivery rate</p>
          <div className="bg-muted rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${deliveryRate}%` }}
            />
          </div>
          <p className="text-sm mt-1 font-medium">{deliveryRate}%</p>
        </div>
      )}
    </div>
  );
}
