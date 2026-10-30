'use client';

import { useEffect, useState } from 'react';
import { Plus, CheckCircle, XCircle, Clock, Pause } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejectionReason: string | null;
  createdAt: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  APPROVED: <CheckCircle className="w-4 h-4 text-green-500" />,
  REJECTED: <XCircle className="w-4 h-4 text-destructive" />,
  PENDING: <Clock className="w-4 h-4 text-amber-500" />,
  PAUSED: <Pause className="w-4 h-4 text-muted-foreground" />,
  DISABLED: <XCircle className="w-4 h-4 text-muted-foreground" />,
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; displayName: string }[]>([]);
  const [form, setForm] = useState({
    whatsappAccountId: '',
    name: '',
    language: 'en',
    category: 'UTILITY',
    bodyText: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [tRes, aRes] = await Promise.all([
        fetch('/api/templates'),
        fetch('/api/whatsapp/accounts'),
      ]);
      if (tRes.ok) setTemplates(await tRes.json());
      if (aRes.ok) setAccounts(await aRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const components = [
        { type: 'BODY', text: form.bodyText },
      ];
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsappAccountId: form.whatsappAccountId,
          name: form.name.toLowerCase().replace(/\s+/g, '_'),
          language: form.language,
          category: form.category,
          components,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Failed to create template');
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Templates</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md"
        >
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleCreate}
            className="bg-background rounded-lg p-6 w-full max-w-md shadow-xl"
          >
            <h2 className="font-semibold mb-4">Create Template</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">WhatsApp Account</label>
                <select
                  required
                  value={form.whatsappAccountId}
                  onChange={(e) => setForm((f) => ({ ...f, whatsappAccountId: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.displayName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Template Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. order_confirmation"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">lowercase, underscores only</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Language</label>
                  <input
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Body Text</label>
                <textarea
                  required
                  rows={3}
                  value={form.bodyText}
                  onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
                  placeholder="Hello {{1}}, your order {{2}} has been confirmed."
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 border rounded-md py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit to Meta'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-background border rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Language</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.language}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {STATUS_ICONS[t.status]}
                      {t.status}
                    </span>
                    {t.rejectionReason && (
                      <p className="text-xs text-destructive mt-0.5">{t.rejectionReason}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
