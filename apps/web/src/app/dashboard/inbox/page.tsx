'use client';

import { useEffect, useState, useRef } from 'react';
import { Send, CheckCheck, Sparkles } from 'lucide-react';

interface Conversation {
  id: string;
  status: string;
  lastMessageAt: string | null;
  sessionExpiresAt: string | null;
  whatsappAccountId: string;
  contact: { id: string; phone: string; name: string | null };
  messages: Array<{ id: string; type?: string; content: { body?: string; templateName?: string }; direction: string }>;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  whatsappAccountId: string;
}

/** Free-form replies are only allowed within 24h of the customer's last message. */
function isSessionOpen(c: Conversation | null) {
  return !!c?.sessionExpiresAt && new Date(c.sessionExpiresAt).getTime() > Date.now();
}

async function errorFrom(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (typeof data.message === 'string') return data.message;
  const first = Object.values(data).flat()[0];
  return typeof first === 'string' ? first : fallback;
}

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: { body?: string; caption?: string; templateName?: string; [key: string]: unknown };
  status: string;
  source?: 'PLATFORM' | 'BUSINESS_APP' | 'HISTORY';
  createdAt: string;
}

function messageText(msg: Message): string {
  if (msg.type === 'revoked') return 'This message was deleted';
  if (msg.type === 'media_placeholder') return '[Media from the WhatsApp Business app]';
  if (msg.type === 'template') return `Template: ${msg.content?.templateName ?? 'message'}`;
  return msg.content?.body ?? msg.content?.caption ?? `[${msg.type}]`;
}

const SOURCE_LABEL: Record<string, string> = {
  BUSINESS_APP: 'Sent from WhatsApp Business app',
  HISTORY: 'Imported from WhatsApp Business app',
};

// Simple date formatter without dependency
function timeAgo(date: string | null) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [sendError, setSendError] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [loadError, setLoadError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadConversations() {
    const res = await fetch('/api/conversations', { cache: 'no-store' });
    if (!res.ok) {
      setLoadError(await errorFrom(res, 'Could not load conversations'));
      return;
    }
    setLoadError('');
    const data = await res.json();
    const items: Conversation[] = data.items ?? [];
    setConversations(items);
    // Keep the open conversation's window and status current.
    setSelected((cur) => (cur ? items.find((c) => c.id === cur.id) ?? cur : cur));
  }

  async function loadMessages(conversationId: string) {
    const res = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' });
    if (res.ok) setMessages(await res.json());
  }

  useEffect(() => {
    loadConversations();
    fetch('/api/templates?status=APPROVED', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates);
    const interval = setInterval(loadConversations, 5000);
    return () => clearInterval(interval);
  }, []);

  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    setSendError('');
    setTemplateId('');
    loadMessages(selectedId);
    const interval = setInterval(() => loadMessages(selectedId), 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selected.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, 'Message not sent'));
      setReply('');
      setSendError('');
      await loadMessages(selected.id);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function sendTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !templateId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selected.id}/messages/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, 'Template not sent'));
      setTemplateId('');
      setSendError('');
      await loadMessages(selected.id);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function suggestReply() {
    if (!selected) return;
    setSuggesting(true);
    try {
      const res = await fetch(`/api/conversations/${selected.id}/suggest-reply`, { method: 'POST' });
      if (res.ok) {
        const { suggestion } = await res.json();
        if (suggestion) setReply(suggestion);
      }
    } finally {
      setSuggesting(false);
    }
  }

  const sessionOpen = isSessionOpen(selected);
  const numberTemplates = templates.filter((t) => t.whatsappAccountId === selected?.whatsappAccountId);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-72 border-r bg-background overflow-y-auto">
        <div className="h-14 border-b flex items-center px-4">
          <h2 className="font-semibold">Inbox</h2>
        </div>
        {loadError ? (
          <p className="p-4 text-sm text-destructive">{loadError}</p>
        ) : conversations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No conversations yet. They appear when a customer messages your WhatsApp number or you send a campaign.
          </p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b hover:bg-muted/40 transition-colors ${
                selected?.id === c.id ? 'bg-primary/10' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate">
                  {c.contact.name ?? c.contact.phone}
                </span>
                <span className="text-xs text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {c.messages[0]?.content?.body ??
                  (c.messages[0]?.content?.templateName ? `Template: ${c.messages[0].content.templateName}` : '—')}
              </p>
            </button>
          ))
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="h-14 border-b flex items-center px-6 bg-background">
              <div>
                <p className="font-semibold text-sm">{selected.contact.name ?? selected.contact.phone}</p>
                <p className="text-xs text-muted-foreground">{selected.contact.phone}</p>
              </div>
              <div className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                sessionOpen ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {sessionOpen
                  ? `Reply window open until ${new Date(selected.sessionExpiresAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Reply window closed: send a template'}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-xs flex flex-col ${msg.direction === 'OUTBOUND' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-3 py-2 rounded-lg text-sm ${
                        msg.direction === 'OUTBOUND'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      } ${msg.type === 'revoked' || msg.type === 'media_placeholder' ? 'italic opacity-80' : ''}`}
                    >
                      {messageText(msg)}
                      {msg.direction === 'OUTBOUND' && (
                        <span className="ml-2 opacity-70">
                          <CheckCheck className="w-3 h-3 inline" />
                        </span>
                      )}
                    </div>
                    {msg.source && SOURCE_LABEL[msg.source] && (
                      <span className="text-[10px] text-muted-foreground mt-0.5">{SOURCE_LABEL[msg.source]}</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {sendError && (
              <p className="px-4 pt-2 text-xs text-destructive border-t bg-background">{sendError}</p>
            )}
            {sessionOpen ? (
              <form onSubmit={sendReply} className={`${sendError ? '' : 'border-t'} bg-background px-4 py-3 flex gap-2`}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a message…"
                  disabled={sending}
                  className="flex-1 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={suggestReply}
                  disabled={suggesting}
                  title="AI suggest reply"
                  className="border rounded-md px-2 py-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4 text-violet-500" />
                </button>
                <button
                  type="submit"
                  disabled={!reply.trim() || sending}
                  className="bg-primary text-primary-foreground px-3 py-2 rounded-md disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={sendTemplate} className={`${sendError ? '' : 'border-t'} bg-background px-4 py-3 space-y-2`}>
                <p className="text-xs text-muted-foreground">
                  WhatsApp only allows approved templates more than 24 hours after the customer&apos;s last message.
                </p>
                <div className="flex gap-2">
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    <option value="">
                      {numberTemplates.length ? 'Choose an approved template…' : 'No approved templates for this number'}
                    </option>
                    {numberTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.language}) · {t.category.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={!templateId || sending}
                    className="bg-primary text-primary-foreground px-3 py-2 rounded-md disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
