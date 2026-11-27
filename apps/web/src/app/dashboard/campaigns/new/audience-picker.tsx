'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

export type AudienceFilter =
  | { mode: 'all' }
  | { mode: 'tags'; tagIds: string[] }
  | { mode: 'contacts'; contactIds: string[] };

interface Tag {
  id: string;
  name: string;
  color: string;
  optedInCount: number;
}

interface PickedContact {
  id: string;
  name: string | null;
  phone: string;
}

interface Props {
  onChange: (filter: AudienceFilter | null, count: number | null) => void;
}

const radioClass = 'flex items-start gap-2 text-sm cursor-pointer';

/**
 * Who receives the campaign. Only opted-in contacts can be chosen; the count comes from
 * the same server-side rule the sender uses, so it matches who will actually get it.
 */
export function AudiencePicker({ onChange }: Props) {
  const [mode, setMode] = useState<AudienceFilter['mode']>('all');
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<PickedContact[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PickedContact[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/contacts/tags', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setTags);
  }, []);

  useEffect(() => {
    if (mode !== 'contacts') return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ optedIn: 'true', limit: '20', ...(search ? { search } : {}) });
      fetch(`/api/contacts?${qs}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: Array<PickedContact & { optedOut?: boolean }> }) =>
          setResults(d.items.filter((c) => !c.optedOut)),
        );
    }, 250);
    return () => clearTimeout(t);
  }, [mode, search]);

  const filter: AudienceFilter | null =
    mode === 'all'
      ? { mode: 'all' }
      : mode === 'tags'
        ? tagIds.length ? { mode: 'tags', tagIds } : null
        : picked.length ? { mode: 'contacts', contactIds: picked.map((c) => c.id) } : null;
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    if (!filter) {
      setCount(null);
      onChange(null, null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch('/api/campaigns/audience-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audienceFilter: filter }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count: number } | null) => {
          if (cancelled) return;
          setCount(d?.count ?? null);
          onChange(filter, d?.count ?? null);
        });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
    // filterKey captures every input of `filter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const toggleTag = (id: string) =>
    setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const togglePick = (c: PickedContact) =>
    setPicked((list) => (list.some((p) => p.id === c.id) ? list.filter((p) => p.id !== c.id) : [...list, c]));

  return (
    <div className="space-y-3">
      <label className={radioClass}>
        <input type="radio" name="audience" checked={mode === 'all'} onChange={() => setMode('all')} className="mt-0.5" />
        <span>All opted-in contacts</span>
      </label>

      <label className={radioClass}>
        <input type="radio" name="audience" checked={mode === 'tags'} onChange={() => setMode('tags')} className="mt-0.5" />
        <span>Contacts with these tags</span>
      </label>
      {mode === 'tags' && (
        <div className="ml-6 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tags yet. Add tags to contacts first.</p>
          ) : (
            tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                className={`text-xs px-2 py-1 rounded-full border ${tagIds.includes(t.id) ? 'text-white border-transparent' : ''}`}
                style={tagIds.includes(t.id) ? { backgroundColor: t.color } : undefined}
              >
                {t.name} · {t.optedInCount}
              </button>
            ))
          )}
        </div>
      )}

      <label className={radioClass}>
        <input type="radio" name="audience" checked={mode === 'contacts'} onChange={() => setMode('contacts')} className="mt-0.5" />
        <span>Choose contacts</span>
      </label>
      {mode === 'contacts' && (
        <div className="ml-6 space-y-2">
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {picked.map((c) => (
                <span key={c.id} className="flex items-center gap-1 text-xs bg-muted rounded px-2 py-0.5">
                  {c.name ?? c.phone}
                  <button type="button" aria-label={`Remove ${c.name ?? c.phone}`} onClick={() => togglePick(c)}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search opted-in contacts by name or phone…"
              className="w-full border rounded-md pl-8 pr-3 py-2 text-sm"
            />
          </div>
          <ul className="border rounded-md max-h-48 overflow-y-auto divide-y">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No opted-in contacts found.</li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={picked.some((p) => p.id === c.id)}
                      onChange={() => togglePick(c)}
                    />
                    <span className="flex-1">{c.name ?? c.phone}</span>
                    {c.name && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filter === null
          ? mode === 'tags' ? 'Pick at least one tag.' : 'Pick at least one contact.'
          : count === null
            ? 'Counting…'
            : count === 0
              ? 'No opted-in contacts match. Nobody would receive this campaign.'
              : `${count.toLocaleString()} opted-in contact${count === 1 ? '' : 's'} will receive this campaign.`}
      </p>
    </div>
  );
}
