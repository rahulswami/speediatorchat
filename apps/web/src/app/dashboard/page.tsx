'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Overview = {
  periodDays: number;
  contacts: { total: number; optedIn: number; optedOut: number; new: number };
  conversations: { open: number; pending: number };
  messages: {
    inbound: number;
    outbound: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    deliveryRate: number;
    readRate: number;
  };
  templates: { approved: number; pending: number; rejected: number };
  numbersConnected: number;
  campaigns: { total: number; running: number; completed: number };
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
    recipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  }>;
  daily: Array<{ day: string; inbound: number; outbound: number }>;
};

const PERIODS = [7, 30, 90] as const;
const n = (v: number) => v.toLocaleString('en-IN');

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <div className="bg-background border rounded-lg p-4 h-full hover:border-primary/40 transition-colors">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function DailyChart({ daily }: { daily: Overview['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.inbound, d.outbound)));
  const label = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const step = Math.ceil(daily.length / 8);
  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Sent by you</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> Received</span>
      </div>
      <div className="flex items-end gap-[2px] h-40">
        {daily.map((d) => (
          <div
            key={d.day}
            className="flex-1 flex items-end justify-center gap-[1px] h-full"
            title={`${label(d.day)}: ${d.outbound} sent, ${d.inbound} received`}
          >
            <div className="flex-1 bg-primary rounded-t-sm min-h-px" style={{ height: `${(d.outbound / max) * 100}%` }} />
            <div className="flex-1 bg-sky-400 rounded-t-sm min-h-px" style={{ height: `${(d.inbound / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1 text-[10px] text-muted-foreground">
        {daily.map((d, i) => (
          <div key={d.day} className="flex-1 text-center whitespace-nowrap overflow-visible">
            {i % step === 0 ? label(d.day) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    fetch(`/api/overview?days=${days}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body.message === 'string' ? body.message : 'Could not load the overview');
        setData(body);
      })
      .catch((e: Error) => setError(e.message));
  }, [days]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="flex border rounded-md overflow-hidden text-sm">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setDays(p)}
              className={`px-3 py-1.5 ${days === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {p} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      {!data ? (
        !error && <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Open conversations" value={n(data.conversations.open)} note={data.conversations.pending ? `${n(data.conversations.pending)} pending` : undefined} href="/dashboard/inbox" />
            <Tile label="Contacts" value={n(data.contacts.total)} note={`${n(data.contacts.optedIn)} opted in · ${n(data.contacts.new)} new`} href="/dashboard/contacts" />
            <Tile label="Approved templates" value={n(data.templates.approved)} note={data.templates.pending ? `${n(data.templates.pending)} waiting for Meta` : undefined} href="/dashboard/templates" />
            <Tile label="Connected numbers" value={n(data.numbersConnected)} href="/dashboard/connect" />
          </div>

          <section className="bg-background border rounded-lg p-5">
            <h2 className="font-semibold mb-1">Messages · last {data.periodDays} days</h2>
            <p className="text-xs text-muted-foreground mb-4">Includes campaign messages and inbox replies.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Tile label="Sent" value={n(data.messages.sent)} />
              <Tile label="Delivered" value={n(data.messages.delivered)} note={`${data.messages.deliveryRate}% of sent`} />
              <Tile label="Read" value={n(data.messages.read)} note={`${data.messages.readRate}% of delivered`} />
              <Tile label="Failed" value={n(data.messages.failed)} />
              <Tile label="Received" value={n(data.messages.inbound)} />
            </div>
            <DailyChart daily={data.daily} />
          </section>

          <section className="bg-background border rounded-lg">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold">Recent campaigns</h2>
              <Link href="/dashboard/campaigns" className="text-xs text-primary">All campaigns</Link>
            </div>
            {data.recentCampaigns.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No campaigns yet. <Link href="/dashboard/campaigns/new" className="underline">Create one</Link>.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Campaign</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Recipients</th>
                    <th className="px-4 py-2 text-right font-medium">Delivered</th>
                    <th className="px-4 py-2 text-right font-medium">Read</th>
                    <th className="px-4 py-2 text-right font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentCampaigns.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      </td>
                      <td className="px-4 py-2 text-xs">{c.status}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(c.recipients)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(c.delivered)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(c.read)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${c.failed ? 'text-destructive' : ''}`}>{n(c.failed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
