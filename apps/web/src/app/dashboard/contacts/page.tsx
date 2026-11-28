'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserX, UserCheck, Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import { AddContactDialog } from './add-contact-dialog';
import { ImportContactsDialog } from './import-contacts-dialog';
import { EditContactDialog } from './edit-contact-dialog';
import { apiErrorMessage } from './api-error';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  optedIn: boolean;
  optInSource: string | null;
  optedOut: boolean;
  lastSeenAt: string | null;
  tagMap: Array<{ tag: { id: string; name: string; color: string } }>;
}

function timeAgo(date: string | null) {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [error, setError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  async function load(q = '') {
    setLoading(true);
    try {
      const qs = q ? `?search=${encodeURIComponent(q)}` : '';
      const res = await fetch(`/api/contacts${qs}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v), 300);
  }

  async function remove(c: Contact) {
    const label = c.name ? `${c.name} (${c.phone})` : c.phone;
    if (!confirm(`Delete ${label}? Their conversations and campaign history are deleted too. This cannot be undone.`)) return;
    setError('');
    const res = await fetch(`/api/contacts/${c.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(apiErrorMessage(await res.json().catch(() => ({})), 'Could not delete the contact'));
      return;
    }
    load(search);
  }

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setDialog('import')}
            className="flex items-center gap-2 whitespace-nowrap text-sm border px-4 py-2 rounded-md"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => setDialog('add')}
            className="flex items-center gap-2 whitespace-nowrap text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md"
          >
            <Plus className="w-4 h-4" /> Add contact
          </button>
        </div>
      </div>

      {dialog === 'add' && (
        <AddContactDialog
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(search); }}
        />
      )}
      {editing && (
        <EditContactDialog
          contact={editing}
          onClose={() => { setEditing(null); load(search); }}
          onSaved={() => { setEditing(null); load(search); }}
        />
      )}
      {error && <p className="text-sm text-destructive mb-3">{error}</p>}
      {dialog === 'import' && (
        <ImportContactsDialog onClose={() => setDialog(null)} onImported={() => load(search)} />
      )}

      <div className="bg-background border rounded-lg overflow-hidden">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={handleSearch}
              placeholder="Search by name or phone…"
              className="w-full border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No contacts found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Name / Phone</th>
                <th className="px-4 py-3 text-left font-medium">Tags</th>
                <th className="px-4 py-3 text-left font-medium">Opt-in</th>
                <th className="px-4 py-3 text-left font-medium">Last seen</th>
                <th className="px-4 py-3 text-right font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.name ?? c.phone}</p>
                    {c.name && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tagMap.map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="px-1.5 py-0.5 rounded text-xs text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.optedOut ? (
                      <span className="flex items-center gap-1 text-destructive text-xs">
                        <UserX className="w-3 h-3" /> Opted out
                      </span>
                    ) : c.optedIn ? (
                      <span
                        className="flex items-center gap-1 text-green-600 text-xs"
                        title={c.optInSource ? `Source: ${c.optInSource}` : undefined}
                      >
                        <UserCheck className="w-3 h-3" /> Opted in
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unknown</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {timeAgo(c.lastSeenAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setEditing(c)}
                        aria-label={`Edit ${c.name ?? c.phone}`}
                        title="Edit"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(c)}
                        aria-label={`Delete ${c.name ?? c.phone}`}
                        title="Delete"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
