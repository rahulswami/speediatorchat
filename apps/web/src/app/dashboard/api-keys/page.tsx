'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Copy, Check } from 'lucide-react';

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', scopes: 'read' });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const data = await fetch('/api/api-keys').then((r) => r.json());
    setKeys(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, scopes: form.scopes.split(',').map((s) => s.trim()) }),
    });
    const data = await res.json();
    if (data.key) {
      setNewKey(data.key);
      await load();
      setShowForm(false);
      setForm({ name: '', scopes: 'read' });
    }
    setCreating(false);
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    await load();
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">Keys for programmatic access to your account</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Create key
        </Button>
      </div>

      {newKey && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-green-800 mb-2">Your new API key — save it now, it won&apos;t be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono text-green-900">{newKey}</code>
            <Button size="sm" variant="outline" className="gap-1" onClick={copyKey}>
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setNewKey(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="border rounded-lg p-4 mb-6 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="keyname">Key name</Label>
            <Input
              id="keyname"
              placeholder="e.g. Production integration"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scopes">Scopes (comma-separated)</Label>
            <Input
              id="scopes"
              placeholder="read, write"
              value={form.scopes}
              onChange={(e) => setForm({ ...form, scopes: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Key</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last used</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{k.keyPrefix}…</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0"
                      onClick={() => revoke(k.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
