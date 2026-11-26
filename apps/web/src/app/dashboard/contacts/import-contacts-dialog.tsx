'use client';

import { useMemo, useState } from 'react';
import { parseCsv } from '@/lib/csv';
import { apiErrorMessage } from './api-error';
import { OptInFields } from './opt-in-fields';

const MAX_ROWS = 5000;
const PREVIEW_ROWS = 5;
const PHONE_HEADER = /phone|mobile|whatsapp|number|contact|cell/i;
const NAME_HEADER = /name/i;

interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  keptOptedOut: number;
  skipped: Array<{ row: number; phone: string; reason: string }>;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function ImportContactsDialog({ onClose, onImported }: Props) {
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [phoneCol, setPhoneCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [optIn, setOptIn] = useState({ optedIn: false, source: '', countryCode: '91' });
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const columnCount = Math.max(0, ...table.map((r) => r.length));
  const headers = Array.from({ length: columnCount }, (_, i) =>
    hasHeader && table[0]?.[i]?.trim() ? table[0][i].trim() : `Column ${i + 1}`,
  );
  const dataRows = hasHeader ? table.slice(1) : table;

  const rows = useMemo(
    () =>
      dataRows
        .map((r, i) => ({
          phone: (r[phoneCol] ?? '').trim(),
          name: nameCol >= 0 ? (r[nameCol] ?? '').trim() || undefined : undefined,
          sheetRow: i + 1 + (hasHeader ? 1 : 0),
        }))
        .filter((r) => r.phone !== ''),
    [dataRows, phoneCol, nameCol, hasHeader],
  );

  async function handleFile(file: File | undefined) {
    setError('');
    setResult(null);
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) {
      setError('That file has no rows.');
      return;
    }
    const first = parsed[0];
    const headerPhone = first.findIndex((c) => PHONE_HEADER.test(c));
    const looksLikeHeader = headerPhone >= 0 || first.every((c) => !/\d{6,}/.test(c));
    setFileName(file.name);
    setTable(parsed);
    setHasHeader(looksLikeHeader);
    setPhoneCol(Math.max(0, headerPhone));
    setNameCol(looksLikeHeader ? first.findIndex((c) => NAME_HEADER.test(c)) : -1);
  }

  async function handleImport() {
    setError('');
    if (rows.length === 0) return setError('No phone numbers found in the selected column.');
    if (rows.length > MAX_ROWS) {
      return setError(`This file has ${rows.length} rows. Import up to ${MAX_ROWS} at a time.`);
    }
    setImporting(true);
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rows.map(({ phone, name }) => ({ phone, name })),
          optedIn: optIn.optedIn,
          optInSource: optIn.optedIn ? optIn.source : undefined,
          defaultCountryCode: optIn.countryCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Import failed'));
      setResult(data as ImportResult);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  // The API numbers rows by position in what was sent; show the spreadsheet row instead.
  const sheetRow = (row: number) => rows[row - 1]?.sheetRow ?? row;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg p-6 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold mb-1">Import contacts from CSV</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Save your spreadsheet as CSV (File → Save As → CSV). Up to {MAX_ROWS.toLocaleString()} rows per file.
          Existing contacts with the same number are updated, not duplicated.
        </p>

        {result ? (
          <div className="space-y-3">
            <ul className="text-sm space-y-1">
              <li><strong>{result.created}</strong> new contacts added</li>
              <li><strong>{result.updated}</strong> existing contacts updated</li>
              {result.unchanged > 0 && <li><strong>{result.unchanged}</strong> already up to date</li>}
              {result.keptOptedOut > 0 && (
                <li>
                  <strong>{result.keptOptedOut}</strong> kept opted out, because they replied STOP earlier
                </li>
              )}
              <li><strong>{result.skipped.length}</strong> rows skipped</li>
            </ul>
            {result.skipped.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Value</th>
                      <th className="px-3 py-2 text-left font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={s.row} className="border-t">
                        <td className="px-3 py-1.5">{sheetRow(s.row)}</td>
                        <td className="px-3 py-1.5 font-mono">{s.phone}</td>
                        <td className="px-3 py-1.5">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={onClose} className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">CSV file</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="text-sm"
              />
            </div>

            {table.length > 0 && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                  First row is column names
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Phone column</label>
                    <select
                      value={phoneCol}
                      onChange={(e) => setPhoneCol(Number(e.target.value))}
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    >
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Name column</label>
                    <select
                      value={nameCol}
                      onChange={(e) => setNameCol(Number(e.target.value))}
                      className="w-full border rounded-md px-3 py-2 text-sm"
                    >
                      <option value={-1}>No name column</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {fileName}: {rows.length.toLocaleString()} rows with a phone number. First {Math.min(PREVIEW_ROWS, rows.length)}:
                  </p>
                  <table className="w-full text-xs border rounded-md">
                    <thead>
                      <tr className="bg-muted/30 text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Phone</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                          <td className="px-3 py-1.5">{r.name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3">
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
                    consentLabel="Everyone in this file agreed to receive WhatsApp messages from us"
                  />
                </div>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 border rounded-md py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || rows.length === 0 || (optIn.optedIn && !optIn.source.trim())}
                className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm disabled:opacity-50"
              >
                {importing ? 'Importing…' : `Import ${rows.length.toLocaleString()} contacts`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
