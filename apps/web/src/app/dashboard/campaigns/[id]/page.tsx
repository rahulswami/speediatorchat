'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Campaign = {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { name: string; language: string; category: string } | null;
};

type Analytics = {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  deliveryRate: number;
  readRate: number;
};

type RecipientFilter = 'all' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'pending';

type Recipient = {
  id: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  contact: { id: string; name: string | null; phone: string };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SCHEDULED: 'bg-purple-100 text-purple-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

const RECIPIENT_LABEL: Record<string, string> = {
  PENDING: 'Waiting',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  SKIPPED_OPTED_OUT: 'Skipped: not opted in',
  SKIPPED_NO_SESSION: 'Skipped',
};

const PAGE_SIZE = 50;

function when(date: string | null) {
  return date ? new Date(date).toLocaleString() : '—';
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Request failed');
  return data;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<RecipientFilter>('all');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    const [c, a] = await Promise.all([
      fetch(`/api/campaigns/${id}`, { cache: 'no-store' }).then(readJson),
      fetch(`/api/campaigns/${id}/analytics`, { cache: 'no-store' }).then(readJson),
    ]);
    setCampaign(c);
    setAnalytics(a);
    if (c.status === 'DRAFT' || c.status === 'SCHEDULED') {
      const n = await fetch(`/api/campaigns/${id}/audience-count`, { cache: 'no-store' }).then(readJson);
      setAudienceCount(n.count);
    }
  }, [id]);

  const loadRecipients = useCallback(
    async (nextPage: number) => {
      const qs = new URLSearchParams({ page: String(nextPage), limit: String(PAGE_SIZE) });
      if (filter !== 'all') qs.set('status', filter);
      const data = await fetch(`/api/campaigns/${id}/recipients?${qs}`, { cache: 'no-store' }).then(readJson);
      setRecipients((list) => (nextPage === 1 ? data.items : [...list, ...data.items]));
      setRecipientTotal(data.total);
      setPage(nextPage);
    },
    [id, filter],
  );

  useEffect(() => {
    loadSummary()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadSummary]);

  useEffect(() => {
    loadRecipients(1).catch((err: Error) => setError(err.message));
  }, [loadRecipients]);

  // Delivery and read receipts keep arriving after sending, so refresh while it's live.
  const live = campaign?.status === 'RUNNING' || (campaign?.status === 'COMPLETED' && !!analytics && analytics.sent > analytics.read);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      loadSummary().catch(() => {});
      loadRecipients(1).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [live, loadSummary, loadRecipients]);

  async function act(action: 'launch' | 'pause') {
    setActionLoading(true);
    setError('');
    try {
      await readJson(await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST' }));
      await loadSummary();
      await loadRecipients(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this campaign? Its results are deleted too.')) return;
    try {
      await readJson(await fetch(`/api/campaigns/${id}`, { method: 'DELETE' }));
      router.push('/dashboard/campaigns');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!campaign) return <div className="p-6 text-sm text-muted-foreground">{error || 'Campaign not found.'}</div>;

  const notStarted = campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED';
  const tiles = analytics
    ? [
        { label: 'Recipients', value: analytics.total.toLocaleString(), note: analytics.pending ? `${analytics.pending} waiting` : undefined },
        { label: 'Sent', value: analytics.sent.toLocaleString() },
        { label: 'Delivered', value: analytics.delivered.toLocaleString(), note: `${analytics.deliveryRate}% of sent` },
        { label: 'Read', value: analytics.read.toLocaleString(), note: `${analytics.readRate}% of delivered` },
        { label: 'Failed', value: analytics.failed.toLocaleString() },
        { label: 'Skipped', value: analytics.skipped.toLocaleString(), note: 'not opted in' },
      ]
    : [];

  return (
    <div className="p-6 max-w-5xl">
      <Link href="/dashboard/campaigns" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3 h-3" /> Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className={`px-2 py-0.5 rounded font-medium ${STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {campaign.status}
            </span>
            {campaign.template && <span>Template: {campaign.template.name} ({campaign.template.language})</span>}
            <span>Created {new Date(campaign.createdAt).toLocaleDateString()}</span>
            {campaign.completedAt && <span>Finished {when(campaign.completedAt)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {(campaign.status === 'DRAFT' || campaign.status === 'PAUSED') && (
            <Button size="sm" className="gap-1" onClick={() => act('launch')} disabled={actionLoading}>
              <Play className="w-3 h-3" /> {campaign.status === 'PAUSED' ? 'Resume' : 'Launch'}
            </Button>
          )}
          {campaign.status === 'RUNNING' && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => act('pause')} disabled={actionLoading}>
              <Pause className="w-3 h-3" /> Pause
            </Button>
          )}
          {['DRAFT', 'PAUSED', 'COMPLETED', 'FAILED'].includes(campaign.status) && (
            <Button size="sm" variant="destructive" onClick={remove}>Delete</Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {notStarted ? (
        <div className="border rounded-lg p-4 mb-6 text-sm">
          {audienceCount === null
            ? 'Counting recipients…'
            : audienceCount === 0
              ? 'No opted-in contacts match this campaign’s audience, so nothing would be sent.'
              : `${audienceCount.toLocaleString()} opted-in contact${audienceCount === 1 ? '' : 's'} will receive this campaign when you launch it.`}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {tiles.map((t) => (
            <div key={t.label} className="border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-2xl font-bold mt-1">{t.value}</p>
              {t.note && <p className="text-xs text-muted-foreground mt-0.5">{t.note}</p>}
            </div>
          ))}
        </div>
      )}

      {!notStarted && (
        <section className="border rounded-lg">
          <div className="flex flex-wrap gap-1 p-3 border-b">
            {(['all', 'sent', 'delivered', 'read', 'failed', 'skipped', 'pending'] as RecipientFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full capitalize ${filter === f ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {f}
              </button>
            ))}
          </div>
          {recipients.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No recipients in this view.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Contact</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Sent</th>
                  <th className="px-4 py-2 text-left font-medium">Delivered</th>
                  <th className="px-4 py-2 text-left font-medium">Read</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{r.contact.name ?? r.contact.phone}</p>
                      {r.contact.name && <p className="text-xs text-muted-foreground">{r.contact.phone}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={r.status === 'FAILED' ? 'text-destructive' : ''}>{RECIPIENT_LABEL[r.status] ?? r.status}</span>
                      {r.error && <p className="text-xs text-muted-foreground max-w-xs">{r.error}</p>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{when(r.sentAt)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{when(r.deliveredAt)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{when(r.readAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recipients.length < recipientTotal && (
            <div className="p-3 border-t text-center">
              <Button size="sm" variant="outline" onClick={() => loadRecipients(page + 1).catch((e: Error) => setError(e.message))}>
                Show more ({recipientTotal - recipients.length} left)
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
