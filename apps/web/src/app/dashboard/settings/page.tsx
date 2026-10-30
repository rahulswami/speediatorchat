'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wifi, WifiOff, Plus } from 'lucide-react';

interface Account {
  id: string;
  displayName: string;
  phoneNumberId: string;
  wabaId: string;
  verified: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch('/api/whatsapp/accounts');
      if (res.ok) setAccounts(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function disconnect(id: string) {
    if (!confirm('Disconnect this account? This will stop receiving messages.')) return;
    await fetch(`/api/whatsapp/accounts/${id}`, { method: 'DELETE' });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Link
          href="/dashboard/connect"
          className="flex items-center gap-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md"
        >
          <Plus className="w-4 h-4" /> Connect Account
        </Link>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">WhatsApp Accounts</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : accounts.length === 0 ? (
          <div className="border rounded-lg p-6 text-center text-muted-foreground">
            <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No accounts connected yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => (
              <div key={a.id} className="border rounded-lg p-4 bg-background flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Wifi className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="font-medium text-sm">{a.displayName}</p>
                    <p className="text-xs text-muted-foreground">+{a.phoneNumberId}</p>
                  </div>
                </div>
                <button
                  onClick={() => disconnect(a.id)}
                  className="text-xs text-destructive hover:underline"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
