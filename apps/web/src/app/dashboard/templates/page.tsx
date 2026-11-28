'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, CheckCircle, XCircle, Clock, Pause, Eye, Copy, Trash2, RefreshCw, X } from 'lucide-react';
import { describeTemplate } from '@speediator/types';
import { TemplatePreview, exampleValues } from '@/components/whatsapp/template-preview';
import { TemplateForm, type Account, type TemplateSource } from './template-form';

interface Template extends TemplateSource {
  id: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  syncedAt: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  APPROVED: <CheckCircle className="w-4 h-4 text-green-500" />,
  REJECTED: <XCircle className="w-4 h-4 text-destructive" />,
  PENDING: <Clock className="w-4 h-4 text-amber-500" />,
  PAUSED: <Pause className="w-4 h-4 text-muted-foreground" />,
  DISABLED: <XCircle className="w-4 h-4 text-muted-foreground" />,
};

const HEADER_LABEL: Record<string, string> = {
  TEXT: 'Text', IMAGE: 'Image', VIDEO: 'Video', DOCUMENT: 'Document', LOCATION: 'Location',
};

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return typeof data.message === 'string' ? data.message : fallback;
}

function TemplateDetails({ template, account, onClose, onDuplicate }: {
  template: Template;
  account?: Account;
  onClose: () => void;
  onDuplicate: () => void;
}) {
  const shape = describeTemplate(template.components);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-background rounded-lg w-full max-w-3xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h2 className="font-semibold">{template.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {template.category.toLowerCase()} · {template.language}
              {account ? ` · ${account.displayName}` : ''}
            </p>
          </div>
          <button aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="grid md:grid-cols-[1fr_300px] gap-6 p-5">
          <dl className="text-sm space-y-3">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="flex items-center gap-1.5">{STATUS_ICONS[template.status]} {template.status}</dd>
              {template.rejectionReason && <dd className="text-xs text-destructive mt-0.5">{template.rejectionReason}</dd>}
            </div>
            {shape.headerFormat && (
              <div>
                <dt className="text-xs text-muted-foreground">Header</dt>
                <dd>{HEADER_LABEL[shape.headerFormat]}{shape.headerText ? `: ${shape.headerText}` : ''}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Message</dt>
              <dd className="whitespace-pre-wrap bg-muted/40 rounded p-2 mt-0.5">{shape.body}</dd>
            </div>
            {shape.footer && (
              <div>
                <dt className="text-xs text-muted-foreground">Footer</dt>
                <dd>{shape.footer}</dd>
              </div>
            )}
            {shape.buttons.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">Buttons</dt>
                {shape.buttons.map((b, i) => (
                  <dd key={i} className="text-sm">
                    {b.text} <span className="text-xs text-muted-foreground">({b.type.toLowerCase().replace('_', ' ')}{b.url ? `: ${b.url}` : ''}{b.phoneNumber ? `: +${b.phoneNumber}` : ''})</span>
                  </dd>
                ))}
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Variables to fill when sending</dt>
              <dd>{shape.slots.length ? shape.slots.map((s) => s.label).join(', ') : 'None'}</dd>
            </div>
          </dl>
          <div>
            <p className="text-sm font-medium mb-2">Preview</p>
            <TemplatePreview components={template.components} values={exampleValues(template.components)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t">
          <button onClick={onDuplicate} className="flex items-center gap-1.5 border rounded-md px-4 py-2 text-sm">
            <Copy className="w-4 h-4" /> Duplicate
          </button>
          <button onClick={onClose} className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ copyOf: TemplateSource | null } | null>(null);
  const [viewing, setViewing] = useState<Template | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, aRes] = await Promise.all([
        fetch('/api/templates', { cache: 'no-store' }),
        fetch('/api/whatsapp/accounts', { cache: 'no-store' }),
      ]);
      if (tRes.ok) setTemplates(await tRes.json());
      if (aRes.ok) setAccounts(await aRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connected = accounts.filter((a) => !a.status || a.status === 'CONNECTED');
  const accountName = (id: string) => accounts.find((a) => a.id === id);

  async function syncAll() {
    setSyncing(true);
    setError('');
    setNote('');
    try {
      const results = await Promise.all(
        connected.map(async (a) => {
          const res = await fetch(`/api/templates/${a.id}/sync`, { method: 'POST' });
          if (!res.ok) throw new Error(`${a.displayName}: ${await readError(res, 'sync failed')}`);
          return (await res.json()) as { synced: number };
        }),
      );
      setNote(`Synced ${results.reduce((n, r) => n + r.synced, 0)} templates from Meta.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function remove(t: Template) {
    if (!confirm(`Remove "${t.name}" (${t.language}) from Speediator? It stays in WhatsApp Manager, and syncing brings it back.`)) return;
    setError('');
    const res = await fetch(`/api/templates/${t.id}`, { method: 'DELETE' });
    if (!res.ok) return setError(await readError(res, 'Could not remove the template'));
    load();
  }

  function duplicate(t: Template) {
    setViewing(null);
    setForm({ copyOf: t });
  }

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Templates</h1>
        <div className="flex gap-2">
          <button
            onClick={syncAll}
            disabled={syncing || connected.length === 0}
            className="flex items-center gap-2 text-sm border px-4 py-2 rounded-md disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync from Meta'}
          </button>
          <button
            onClick={() => setForm({ copyOf: null })}
            disabled={connected.length === 0}
            className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> New template
          </button>
        </div>
      </div>

      {note && <p className="text-sm text-muted-foreground mb-3">{note}</p>}
      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      {form && (
        <TemplateForm
          accounts={connected}
          copyOf={form.copyOf}
          onClose={() => setForm(null)}
          onCreated={() => { setForm(null); setNote('Template submitted. Meta usually reviews it within minutes; click Sync from Meta to see the result.'); load(); }}
        />
      )}
      {viewing && (
        <TemplateDetails
          template={viewing}
          account={accountName(viewing.whatsappAccountId)}
          onClose={() => setViewing(null)}
          onDuplicate={() => duplicate(viewing)}
        />
      )}

      <div className="bg-background border rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No templates yet. Create one, or sync the ones you made in WhatsApp Manager.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Message</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const shape = describeTemplate(t.components);
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20 align-top">
                    <td className="px-4 py-3">
                      <button onClick={() => setViewing(t)} className="font-medium hover:underline text-left">{t.name}</button>
                      <p className="text-xs text-muted-foreground">
                        {t.language}{accountName(t.whatsappAccountId) ? ` · ${accountName(t.whatsappAccountId)!.displayName}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <p className="text-xs text-muted-foreground line-clamp-2">{shape.body}</p>
                      {shape.headerFormat && shape.headerFormat !== 'TEXT' && (
                        <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-muted rounded px-1.5 py-0.5">
                          {HEADER_LABEL[shape.headerFormat]} header
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{t.category.toLowerCase()}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">{STATUS_ICONS[t.status]} {t.status}</span>
                      {t.rejectionReason && <p className="text-xs text-destructive mt-0.5">{t.rejectionReason}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setViewing(t)} title="View" aria-label={`View ${t.name}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => duplicate(t)} title="Duplicate" aria-label={`Duplicate ${t.name}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                          <Copy className="w-4 h-4" />
                        </button>
                        <button onClick={() => remove(t)} title="Remove" aria-label={`Remove ${t.name}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
