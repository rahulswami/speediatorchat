'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NewCampaignPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    whatsappAccountId: '',
    templateId: '',
    scheduledAt: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body: Record<string, string> = {
        name: form.name,
        whatsappAccountId: form.whatsappAccountId,
        templateId: form.templateId,
      };
      if (form.scheduledAt) body.scheduledAt = new Date(form.scheduledAt).toISOString();

      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Failed to create campaign');
      }
      const camp = await res.json();
      router.push(`/dashboard/campaigns/${camp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-semibold mb-6">New Campaign</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Campaign name</Label>
          <Input
            id="name"
            placeholder="e.g. Diwali Sale 2026"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="waId">WhatsApp Account ID</Label>
          <Input
            id="waId"
            placeholder="UUID of the connected account"
            value={form.whatsappAccountId}
            onChange={(e) => setForm({ ...form, whatsappAccountId: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tplId">Template ID</Label>
          <Input
            id="tplId"
            placeholder="UUID of an approved template"
            value={form.templateId}
            onChange={(e) => setForm({ ...form, templateId: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sched">Schedule (optional)</Label>
          <Input
            id="sched"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create campaign'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
