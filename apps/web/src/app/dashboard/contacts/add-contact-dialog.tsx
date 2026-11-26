'use client';

import { useState } from 'react';
import { apiErrorMessage } from './api-error';
import { OptInFields } from './opt-in-fields';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function AddContactDialog({ onClose, onSaved }: Props) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [optIn, setOptIn] = useState({ optedIn: false, source: '', countryCode: '91' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          name,
          optedIn: optIn.optedIn,
          optInSource: optIn.optedIn ? optIn.source : undefined,
          defaultCountryCode: optIn.countryCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Could not add contact'));
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
        <h2 className="font-semibold mb-4">Add contact</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">WhatsApp number</label>
            <input
              required
              autoFocus
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +91 98765 43210"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <OptInFields
            optedIn={optIn.optedIn}
            source={optIn.source}
            countryCode={optIn.countryCode}
            onChange={(next) =>
              setOptIn((o) => ({
                optedIn: next.optedIn ?? o.optedIn,
                source: next.source ?? o.source,
                countryCode: next.countryCode ?? o.countryCode,
              }))
            }
            consentLabel="This person agreed to receive WhatsApp messages from us"
          />
        </div>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="flex-1 border rounded-md py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add contact'}
          </button>
        </div>
      </form>
    </div>
  );
}
