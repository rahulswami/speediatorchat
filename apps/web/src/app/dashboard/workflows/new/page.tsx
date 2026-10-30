'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TRIGGER_TYPES = [
  { value: 'CONTACT_CREATED', label: 'Contact created' },
  { value: 'CONTACT_OPT_IN', label: 'Contact opted in' },
  { value: 'INBOUND_MESSAGE', label: 'Inbound message received' },
  { value: 'KEYWORD', label: 'Keyword trigger' },
  { value: 'MANUAL', label: 'Manual trigger' },
];

export default function NewWorkflowPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', triggerType: 'CONTACT_CREATED' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Failed to create workflow');
      }
      const wf = await res.json();
      router.push(`/dashboard/workflows/${wf.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-semibold mb-6">New Workflow</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Workflow name</Label>
          <Input
            id="name"
            placeholder="e.g. Welcome new contacts"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trigger">Trigger</Label>
          <select
            id="trigger"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={form.triggerType}
            onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create workflow'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
