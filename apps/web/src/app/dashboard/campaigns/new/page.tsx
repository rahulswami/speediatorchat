'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AudiencePicker, type AudienceFilter } from './audience-picker';
import { VariablesEditor } from './variables-editor';
import { variableProblems, type TemplateVariables } from '@speediator/types';

interface WhatsappAccount {
  id: string;
  displayName: string;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
  status: 'CONNECTED' | 'SETUP_INCOMPLETE' | 'DISCONNECTED';
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectionReason: string | null;
  whatsappAccountId?: string;
  components?: unknown;
}

const selectClass = 'w-full border rounded-md px-3 py-2 text-sm bg-background';

function errorMessage(data: unknown, fallback: string) {
  const message = (data as { message?: unknown })?.message;
  return typeof message === 'string' ? message : fallback;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<WhatsappAccount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ name: '', whatsappAccountId: '', templateId: '', scheduledAt: '' });
  const [typedName, setTypedName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [variables, setVariables] = useState<TemplateVariables>({ values: {} });
  const [audience, setAudience] = useState<{ filter: AudienceFilter | null; count: number | null }>({
    filter: { mode: 'all' },
    count: null,
  });
  const onAudienceChange = useCallback(
    (filter: AudienceFilter | null, count: number | null) => setAudience({ filter, count }),
    [],
  );

  useEffect(() => {
    fetch('/api/whatsapp/accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: WhatsappAccount[]) => {
        const connected = list.filter((a) => a.status === 'CONNECTED');
        setAccounts(connected);
        if (connected.length === 1) setForm((f) => ({ ...f, whatsappAccountId: connected[0].id }));
      });
    fetch('/api/templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates);
  }, []);

  const accountTemplates = useMemo(
    () => templates.filter((t) => t.whatsappAccountId === form.whatsappAccountId),
    [templates, form.whatsappAccountId],
  );
  const approved = accountTemplates.filter((t) => t.status === 'APPROVED');
  const selectedTemplate = templates.find((t) => t.id === form.templateId);
  const problems = selectedTemplate ? variableProblems(selectedTemplate.components, variables) : [];

  /** Pulls the latest templates and statuses for this number from Meta. */
  const syncTemplates = useCallback(async (): Promise<Template[] | null> => {
    if (!form.whatsappAccountId) return null;
    setSyncing(true);
    setSyncNote('');
    try {
      const res = await fetch(`/api/templates/${form.whatsappAccountId}/sync`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Could not sync templates from Meta'));
      const synced = (data.templates as Template[]).map((t) => ({ ...t, whatsappAccountId: form.whatsappAccountId }));
      // The sync result has no components, so reload the full list for the variable editor.
      const full = await fetch('/api/templates', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      if (full) setTemplates(full);
      const count = synced.filter((t) => t.status === 'APPROVED').length;
      setSyncNote(`Synced from Meta: ${count} approved template${count === 1 ? '' : 's'}.`);
      return synced;
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSyncing(false);
    }
  }, [form.whatsappAccountId]);

  // Typing a name still goes through Meta: only a template Meta reports as APPROVED is used.
  async function findTypedTemplate() {
    const name = typedName.trim().toLowerCase();
    if (!name) return;
    const synced = await syncTemplates();
    if (!synced) return;
    const matches = synced.filter((t) => t.name === name);
    const match = matches.find((t) => t.status === 'APPROVED');
    if (match) {
      setForm((f) => ({ ...f, templateId: match.id }));
      setVariables({ values: {} });
      setSyncNote(`Found "${match.name}" (${match.language}), approved by Meta.`);
      setTypedName('');
    } else if (matches.length) {
      const t = matches[0];
      setSyncNote(
        `"${t.name}" exists but its status in Meta is ${t.status}${t.rejectionReason ? ` (${t.rejectionReason})` : ''}. Only approved templates can be sent.`,
      );
    } else {
      setSyncNote(`No template named "${name}" on this number in Meta. Check the spelling in WhatsApp Manager → Message templates.`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        whatsappAccountId: form.whatsappAccountId,
        templateId: form.templateId,
        audienceFilter: audience.filter,
        variableMap: variables,
      };
      if (form.scheduledAt) body.scheduledAt = new Date(form.scheduledAt).toISOString();

      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, 'Failed to create campaign'));
      router.push(`/dashboard/campaigns/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-xl">
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
          <Label htmlFor="account">WhatsApp number</Label>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connected number yet. Connect one on the{' '}
              <a href="/dashboard/connect" className="underline">Connect</a> page first.
            </p>
          ) : (
            <select
              id="account"
              required
              value={form.whatsappAccountId}
              onChange={(e) => {
                setForm({ ...form, whatsappAccountId: e.target.value, templateId: '' });
                setVariables({ values: {} });
                setSyncNote('');
              }}
              className={selectClass}
            >
              <option value="">Choose a number…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.displayPhoneNumber ? ` · ${a.displayPhoneNumber}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {form.whatsappAccountId && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="template">Approved template</Label>
              <button
                type="button"
                onClick={syncTemplates}
                disabled={syncing}
                className="flex items-center gap-1 text-xs text-primary disabled:opacity-60"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync from Meta'}
              </button>
            </div>
            <select
              id="template"
              required
              value={form.templateId}
              onChange={(e) => {
                setForm({ ...form, templateId: e.target.value });
                setVariables({ values: {} });
              }}
              className={selectClass}
            >
              <option value="">
                {approved.length ? 'Choose a template…' : 'No approved templates yet — sync from Meta'}
              </option>
              {approved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language}) · {t.category.toLowerCase()}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <Input
                aria-label="Template name"
                placeholder="Or type its name, e.g. hello_test"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    findTypedTemplate();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={findTypedTemplate} disabled={syncing || !typedName.trim()}>
                Find
              </Button>
            </div>
            {syncNote && <p className="text-xs text-muted-foreground">{syncNote}</p>}
          </div>
        )}

        {selectedTemplate && (
          <div className="space-y-2">
            <Label>Message content</Label>
            <VariablesEditor
              components={selectedTemplate.components}
              whatsappAccountId={form.whatsappAccountId}
              value={variables}
              onChange={setVariables}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Who receives it</Label>
          <AudiencePicker onChange={onAudienceChange} />
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
        {problems.length > 0 && (
          <ul className="text-xs text-amber-700 list-disc pl-4">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={loading || !form.templateId || !audience.filter || problems.length > 0}>
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
