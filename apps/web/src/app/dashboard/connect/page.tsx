'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Facebook, ChevronDown } from 'lucide-react';
import {
  loadFacebookSdk,
  runEmbeddedSignup,
  SignupCancelled,
  type EmbeddedSignupConfig,
  type FbSdk,
} from './embedded-signup';
import { ManualConnectForm } from './manual-connect-form';

interface WhatsappAccount {
  id: string;
  displayName: string;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
  connectionMethod: 'MANUAL' | 'EMBEDDED_SIGNUP';
  status: 'CONNECTED' | 'SETUP_INCOMPLETE' | 'DISCONNECTED';
  isOnBizApp: boolean;
  webhooksSubscribedAt: string | null;
  registeredAt: string | null;
  contactsSyncRequestedAt: string | null;
  historySyncRequestedAt: string | null;
  historySyncProgress: number | null;
  historySyncDeclinedAt: string | null;
  lastSetupError: string | null;
}

function historyNote(a: WhatsappAccount): string | null {
  if (!a.isOnBizApp || !a.historySyncRequestedAt) return null;
  if (a.historySyncDeclinedAt) return 'Chat history sharing is turned off in the WhatsApp Business app';
  if (a.historySyncProgress === null) return 'Waiting for chat history from WhatsApp…';
  if (a.historySyncProgress >= 100) return 'Chat history imported';
  return `Importing chat history: ${a.historySyncProgress}%`;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'facebook' }
  | { kind: 'finishing' }
  | { kind: 'done'; account: WhatsappAccount }
  | { kind: 'error'; message: string };

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data.message === 'string' ? data.message : Object.values(data).flat()[0];
    throw new Error(typeof message === 'string' ? message : 'Something went wrong');
  }
  return data;
}

function setupSteps(a: WhatsappAccount) {
  const steps = [
    { label: 'Access granted by Facebook', done: true },
    { label: 'Messages and status updates linked', done: !!a.webhooksSubscribedAt },
    a.isOnBizApp
      ? { label: 'Number kept on your WhatsApp Business app', done: true }
      : { label: 'Number registered for the API', done: !!a.registeredAt },
  ];
  if (a.isOnBizApp) {
    steps.push(
      { label: 'Contacts sync requested', done: !!a.contactsSyncRequestedAt },
      { label: 'Chat history sync requested', done: !!a.historySyncRequestedAt },
    );
  }
  return steps;
}

function StatusBadge({ status }: { status: WhatsappAccount['status'] }) {
  const styles = {
    CONNECTED: 'bg-green-100 text-green-700',
    SETUP_INCOMPLETE: 'bg-amber-100 text-amber-700',
    DISCONNECTED: 'bg-red-100 text-red-700',
  }[status];
  const label = { CONNECTED: 'Connected', SETUP_INCOMPLETE: 'Setup incomplete', DISCONNECTED: 'Disconnected' }[status];
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles}`}>{label}</span>;
}

function StepList({ account }: { account: WhatsappAccount }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {setupSteps(account).map((s) => (
        <li key={s.label} className="flex items-center gap-2">
          {s.done ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          ) : (
            <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className={s.done ? '' : 'text-muted-foreground'}>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ConnectWhatsAppPage() {
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [accounts, setAccounts] = useState<WhatsappAccount[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [sdk, setSdk] = useState<FbSdk | null>(null);
  // Bumped on cancel so a late answer from an abandoned popup is ignored.
  const runId = useRef(0);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/whatsapp/accounts', { cache: 'no-store' });
    if (res.ok) setAccounts(await res.json());
  }, []);

  useEffect(() => {
    fetch('/api/whatsapp/embedded-signup/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setConfig)
      .catch(() => setConfig(null));
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!config?.enabled) return;
    loadFacebookSdk(config)
      .then(setSdk)
      .catch((err: Error) => setPhase({ kind: 'error', message: err.message }));
  }, [config]);

  async function connectWithFacebook() {
    if (!config?.enabled || !sdk) return;
    const id = ++runId.current;
    setPhase({ kind: 'facebook' });
    try {
      const result = await runEmbeddedSignup(sdk, config);
      if (id !== runId.current) return;
      setPhase({ kind: 'finishing' });
      const account = (await readJson(
        await fetch('/api/whatsapp/embedded-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        }),
      )) as WhatsappAccount;
      if (id !== runId.current) return;
      setPhase({ kind: 'done', account });
      loadAccounts();
    } catch (err) {
      if (id !== runId.current) return;
      if (err instanceof SignupCancelled) setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function finishSetup(id: string) {
    setRetrying(id);
    try {
      const account = (await readJson(
        await fetch(`/api/whatsapp/accounts/${id}/finish-setup`, { method: 'POST' }),
      )) as WhatsappAccount;
      if (phase.kind === 'done' && phase.account.id === id) setPhase({ kind: 'done', account });
      await loadAccounts();
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRetrying(null);
    }
  }

  const busy = phase.kind === 'facebook' || phase.kind === 'finishing';

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Connect WhatsApp</h1>
        <p className="text-muted-foreground text-sm">
          Link your WhatsApp Business number to Speediator through Facebook. It takes about two minutes.
        </p>
      </div>

      <section className="bg-background border rounded-lg p-6 space-y-4">
        <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
          <li>Log in to Facebook and choose or create your business.</li>
          <li>Pick a WhatsApp number: add a new one and verify it by SMS or call, or connect the number you use on the WhatsApp Business app.</li>
          <li>Speediator finishes the setup for you.</li>
        </ol>

        {config && !config.enabled ? (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 p-3">
            Connect with Facebook isn&apos;t set up on this server yet. An admin needs to add the Meta app ID and
            Embedded Signup configuration ID. Until then, use the manual option below.
          </p>
        ) : (
          <button
            onClick={connectWithFacebook}
            disabled={!sdk || busy}
            className="flex items-center justify-center gap-2 w-full rounded-md py-2.5 text-sm font-medium text-white bg-[#1877F2] disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
            {phase.kind === 'facebook'
              ? 'Finish the steps in the Facebook window…'
              : phase.kind === 'finishing'
                ? 'Setting up your number…'
                : sdk
                  ? 'Connect with Facebook'
                  : 'Loading Facebook…'}
          </button>
        )}

        {phase.kind === 'facebook' && (
          <p className="text-xs text-muted-foreground text-center">
            No Facebook window? Allow pop-ups for this site and try again.{' '}
            <button
              onClick={() => { runId.current++; setPhase({ kind: 'idle' }); }}
              className="underline"
            >
              Cancel
            </button>
          </p>
        )}

        {phase.kind === 'done' && (
          <div className="border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                {phase.account.displayName}
                {phase.account.displayPhoneNumber && (
                  <span className="text-muted-foreground font-normal"> · {phase.account.displayPhoneNumber}</span>
                )}
              </p>
              <StatusBadge status={phase.account.status} />
            </div>
            <StepList account={phase.account} />
            {phase.account.lastSetupError && (
              <p className="text-sm text-amber-700 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {phase.account.lastSetupError}
              </p>
            )}
            {phase.account.status === 'SETUP_INCOMPLETE' && (
              <button
                onClick={() => finishSetup(phase.account.id)}
                disabled={retrying === phase.account.id}
                className="text-sm border rounded-md px-3 py-1.5 disabled:opacity-60"
              >
                {retrying === phase.account.id ? 'Retrying…' : 'Retry setup'}
              </button>
            )}
          </div>
        )}

        {phase.kind === 'error' && (
          <p className="text-sm text-destructive flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {phase.message}
          </p>
        )}
      </section>

      {accounts.length > 0 && (
        <section className="bg-background border rounded-lg">
          <h2 className="font-semibold px-6 pt-5 pb-3">Your numbers</h2>
          <ul>
            {accounts.map((a) => (
              <li key={a.id} className="border-t px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.displayPhoneNumber ?? `Phone number ID ${a.phoneNumberId}`}
                    {a.isOnBizApp && ' · also on WhatsApp Business app'}
                    {a.connectionMethod === 'MANUAL' && ' · connected manually'}
                  </p>
                  {historyNote(a) && <p className="text-xs text-muted-foreground mt-0.5">{historyNote(a)}</p>}
                  {a.status !== 'CONNECTED' && a.lastSetupError && (
                    <p className="text-xs text-amber-700 mt-1">{a.lastSetupError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={a.status} />
                  {a.status === 'SETUP_INCOMPLETE' && (
                    <button
                      onClick={() => finishSetup(a.id)}
                      disabled={retrying === a.id}
                      className="text-xs border rounded-md px-2 py-1 disabled:opacity-60"
                    >
                      {retrying === a.id ? 'Retrying…' : 'Finish setup'}
                    </button>
                  )}
                  {a.status === 'DISCONNECTED' && config?.enabled && (
                    <button
                      onClick={connectWithFacebook}
                      disabled={!sdk || busy}
                      className="text-xs border rounded-md px-2 py-1 disabled:opacity-60"
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-background border rounded-lg">
        <button
          onClick={() => setShowManual((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-sm font-medium"
        >
          Advanced: connect manually with IDs and a token
          <ChevronDown className={`w-4 h-4 transition-transform ${showManual ? 'rotate-180' : ''}`} />
        </button>
        {showManual && (
          <div className="px-6 pb-6">
            <ManualConnectForm onConnected={() => { setShowManual(false); loadAccounts(); }} />
          </div>
        )}
      </section>
    </div>
  );
}
