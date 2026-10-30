'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Webhook } from 'lucide-react';

type OutboundWebhook = {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
};

const ALL_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'campaign.completed',
  'contact.opted_out',
];

export default function WebhooksPage() {
  const [hooks, setHooks] = useState<OutboundWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ url: '', events: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  async function load() {
    const data = await fetch('/api/outbound-webhooks').then((r) => r.json());
    setHooks(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/outbound-webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.secret) setNewSecret(data.secret);
    await load();
    setShowForm(false);
    setForm({ url: '', events: [] });
    setCreating(false);
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook endpoint?')) return;
    await fetch(`/api/outbound-webhooks/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Outbound Webhooks</h1>
          <p className="text-sm text-muted-foreground mt-1">Push events to your server in real time</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add endpoint
        </Button>
      </div>

      {newSecret && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-green-800 mb-1">Webhook signing secret — save it now</p>
          <code className="block bg-white border rounded px-3 py-2 text-sm font-mono text-green-900">{newSecret}</code>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setNewSecret(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="border rounded-lg p-4 mb-6 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="url">Endpoint URL</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://your-server.com/webhook"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Events to subscribe</Label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {ALL_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={creating || form.events.length === 0}>
              {creating ? 'Adding…' : 'Add endpoint'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : hooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Webhook className="w-10 h-10 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">No webhook endpoints yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => (
            <div key={h.id} className="border rounded-lg p-4 flex items-start justify-between">
              <div>
                <p className="font-mono text-sm font-medium">{h.url}</p>
                <p className="text-xs text-muted-foreground mt-1">{h.events.join(', ')}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive h-7 w-7 p-0 ml-4 shrink-0"
                onClick={() => remove(h.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
