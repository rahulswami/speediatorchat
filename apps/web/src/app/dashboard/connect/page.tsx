'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectWhatsAppPage() {
  const router = useRouter();
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
      router.push('/dashboard/settings');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-2">Connect WhatsApp</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Enter your WhatsApp Business API credentials from Meta Business Manager.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 bg-background border rounded-lg p-6">
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
    </div>
  );
}
