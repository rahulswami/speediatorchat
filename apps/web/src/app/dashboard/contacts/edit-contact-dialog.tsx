'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { apiErrorMessage } from './api-error';

export interface EditableContact {
  id: string;
  phone: string;
  name: string | null;
  optedIn: boolean;
  optedOut: boolean;
  optInSource: string | null;
  tagMap: Array<{ tag: { id: string; name: string; color: string } }>;
}

interface Props {
  contact: EditableContact;
  onClose: () => void;
  onSaved: () => void;
}

type Consent = 'in' | 'out' | 'unknown';

const consentOf = (c: EditableContact): Consent => (c.optedOut ? 'out' : c.optedIn ? 'in' : 'unknown');

async function call(url: string, init: RequestInit, fallback: string) {
  const res = await fetch(url, init);
  if (res.ok) return;
  throw new Error(apiErrorMessage(await res.json().catch(() => ({})), fallback));
}

export function EditContactDialog({ contact, onClose, onSaved }: Props) {
  const [name, setName] = useState(contact.name ?? '');
  const [consent, setConsent] = useState<Consent>(consentOf(contact));
  const [source, setSource] = useState('');
  const [tags, setTags] = useState(contact.tagMap.map((m) => m.tag));
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const original = consentOf(contact);
  const optingIn = consent === 'in' && original !== 'in';

  async function addTag() {
    const tagName = newTag.trim();
    if (!tagName || tags.some((t) => t.name.toLowerCase() === tagName.toLowerCase())) return setNewTag('');
    setError('');
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Could not add the tag'));
      setTags((list) => [...list, data]);
      setNewTag('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeTag(tagId: string) {
    setError('');
    try {
      await call(`/api/contacts/${contact.id}/tags/${tagId}`, { method: 'DELETE' }, 'Could not remove the tag');
      setTags((list) => list.filter((t) => t.id !== tagId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name };
      if (consent !== original && consent !== 'unknown') {
        body.optedIn = consent === 'in';
        if (optingIn) body.optInSource = source;
      }
      await call(
        `/api/contacts/${contact.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Could not save the contact',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-background rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="font-semibold">Edit contact</h2>
        <p className="text-xs text-muted-foreground mb-4">{contact.phone}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">WhatsApp marketing consent</label>
            <select
              value={consent}
              onChange={(e) => setConsent(e.target.value as Consent)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {original === 'unknown' && <option value="unknown">Not asked yet</option>}
              <option value="in">Opted in</option>
              <option value="out">Opted out</option>
            </select>
            {original === 'in' && contact.optInSource && consent === 'in' && (
              <p className="text-xs text-muted-foreground mt-1">Source: {contact.optInSource}</p>
            )}
            {optingIn && (
              <div className="mt-2">
                <input
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  maxLength={200}
                  placeholder="Where did they agree? e.g. Website form"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
                {original === 'out' && (
                  <p className="text-xs text-amber-700 mt-1">
                    This person opted out before. Only opt them back in if they agreed again.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                  <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => removeTag(t.id)}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag, e.g. VIP"
                className="flex-1 border rounded-md px-3 py-2 text-sm"
              />
              <button type="button" onClick={addTag} className="border rounded-md px-3 text-sm">
                Add
              </button>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 border rounded-md py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
