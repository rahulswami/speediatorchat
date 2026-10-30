'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, ExternalLink } from 'lucide-react';

const INTEGRATIONS = [
  {
    type: 'SHOPIFY',
    name: 'Shopify',
    description: 'Sync orders and customers from your Shopify store.',
    fields: [{ key: 'shopDomain', label: 'Shop domain', placeholder: 'mystore.myshopify.com' }],
  },
  {
    type: 'RAZORPAY',
    name: 'Razorpay',
    description: 'Receive payment events and send confirmations automatically.',
    fields: [{ key: 'webhookSecret', label: 'Webhook secret', placeholder: 'rzp_…' }],
  },
  {
    type: 'GOOGLE_SHEETS',
    name: 'Google Sheets',
    description: 'Sync contacts from a Google Sheet.',
    fields: [{ key: 'spreadsheetId', label: 'Spreadsheet ID', placeholder: '1BxiM…' }],
  },
  {
    type: 'ZAPIER',
    name: 'Zapier',
    description: 'Connect Speediator to 5,000+ apps via Zapier.',
    fields: [{ key: 'apiKey', label: 'Zapier API key', placeholder: 'zap_…' }],
  },
];

export default function IntegrationsPage() {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function connect(type: string) {
    setSaving(type);
    const config = configs[type] ?? {};
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, config }),
    });
    if (res.ok) {
      setConnected({ ...connected, [type]: true });
      setConnecting(null);
    }
    setSaving(null);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">Connect Speediator to your existing tools</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INTEGRATIONS.map((intg) => (
          <div key={intg.type} className="border rounded-lg p-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-medium">{intg.name}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{intg.description}</p>
              </div>
              {connected[intg.type] && (
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0 ml-2" />
              )}
            </div>

            {connecting === intg.type ? (
              <div className="mt-3 space-y-2">
                {intg.fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      placeholder={f.placeholder}
                      value={configs[intg.type]?.[f.key] ?? ''}
                      onChange={(e) =>
                        setConfigs({
                          ...configs,
                          [intg.type]: { ...(configs[intg.type] ?? {}), [f.key]: e.target.value },
                        })
                      }
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => connect(intg.type)} disabled={saving === intg.type}>
                    {saving === intg.type ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConnecting(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant={connected[intg.type] ? 'outline' : 'default'}
                className="mt-3 gap-1"
                onClick={() => setConnecting(intg.type)}
              >
                <ExternalLink className="w-3 h-3" />
                {connected[intg.type] ? 'Edit' : 'Connect'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
