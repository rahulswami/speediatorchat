'use client';

import { useState } from 'react';

export function ManualConnectForm({ onConnected }: { onConnected: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    wabaId: '',
    phoneNumberId: '',
    displayName: '',
    accessToken: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Failed to connect');
      }
      setForm({ wabaId: '', phoneNumberId: '', displayName: '', accessToken: '' });
      onConnected();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        For a number you already set up in Meta yourself: paste its IDs and a system-user access token.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {[
          { id: 'wabaId', label: 'WABA ID', placeholder: 'e.g. 1234567890' },
          { id: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'e.g. 9876543210' },
          { id: 'displayName', label: 'Display Name', placeholder: 'e.g. Acme Support' },
          { id: 'accessToken', label: 'Access Token', placeholder: 'EAAxxxxx...', type: 'password' },
        ].map(({ id, label, placeholder, type = 'text' }) => (
          <div key={id}>
            <label htmlFor={id} className="block text-sm font-medium mb-1">
              {label}
            </label>
            <input
              id={id}
              type={type}
              required
              value={form[id as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
              placeholder={placeholder}
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? 'Connecting…' : 'Connect Account'}
        </button>
      </form>
    </>
  );
}
