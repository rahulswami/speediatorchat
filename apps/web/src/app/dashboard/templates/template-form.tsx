'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import {
  NewTemplateSchema,
  placeholders,
  templateToFormValues,
  type TemplateButtonInput,
} from '@speediator/types';
import { TemplatePreview } from '@/components/whatsapp/template-preview';
import { MEDIA_ACCEPT, uploadFile } from '@/lib/upload';

export interface Account {
  id: string;
  displayName: string;
  displayPhoneNumber?: string | null;
  status?: string;
}

export interface TemplateSource {
  name: string;
  language: string;
  category: string;
  whatsappAccountId: string;
  components: unknown;
}

type HeaderChoice = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type MediaHeader = Exclude<HeaderChoice, 'NONE' | 'TEXT'>;

const LANGUAGES = [
  ['en', 'English'], ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['hi', 'Hindi'],
  ['mr', 'Marathi'], ['gu', 'Gujarati'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'],
  ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
] as const;

const BUTTON_LABEL: Record<TemplateButtonInput['type'], string> = {
  QUICK_REPLY: 'Quick reply',
  URL: 'Website',
  PHONE_NUMBER: 'Call',
  COPY_CODE: 'Copy code',
};

const field = 'w-full border rounded-md px-3 py-2 text-sm bg-background';

function emptyButton(type: TemplateButtonInput['type']): TemplateButtonInput {
  switch (type) {
    case 'QUICK_REPLY':
      return { type, text: '' };
    case 'URL':
      return { type, text: '', url: 'https://', example: '' };
    case 'PHONE_NUMBER':
      return { type, text: '', phoneNumber: '+91' };
    case 'COPY_CODE':
      return { type, example: '' };
  }
}

interface Props {
  accounts: Account[];
  /** Set when duplicating: the form starts with this template's content. */
  copyOf?: TemplateSource | null;
  onClose: () => void;
  onCreated: () => void;
}

export function TemplateForm({ accounts, copyOf, onClose, onCreated }: Props) {
  const start = copyOf ? templateToFormValues(copyOf.components) : null;
  const startHeader = start?.header.format === 'LOCATION' ? 'NONE' : start?.header.format;

  const [accountId, setAccountId] = useState(copyOf?.whatsappAccountId ?? (accounts.length === 1 ? accounts[0].id : ''));
  const [name, setName] = useState(copyOf ? `${copyOf.name}_copy`.slice(0, 512) : '');
  const [language, setLanguage] = useState(copyOf?.language ?? 'en');
  const [category, setCategory] = useState(copyOf?.category === 'UTILITY' ? 'UTILITY' : 'MARKETING');
  const [headerFormat, setHeaderFormat] = useState<HeaderChoice>((startHeader as HeaderChoice) ?? 'NONE');
  const [headerText, setHeaderText] = useState(start?.header.text ?? '');
  const [headerExample, setHeaderExample] = useState(start?.header.example ?? '');
  const [media, setMedia] = useState<{ handle: string; fileName: string; previewUrl: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState(start?.body ?? '');
  const [bodyExamples, setBodyExamples] = useState<string[]>(start?.bodyExamples ?? []);
  const [footer, setFooter] = useState(start?.footer ?? '');
  const [buttons, setButtons] = useState<TemplateButtonInput[]>(start?.buttons ?? []);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const bodyVars = placeholders(body);
  const headerHasVar = headerFormat === 'TEXT' && placeholders(headerText).length > 0;
  const isMediaHeader = headerFormat !== 'NONE' && headerFormat !== 'TEXT';

  const input = {
    whatsappAccountId: accountId,
    name: name.trim().toLowerCase().replace(/[\s-]+/g, '_'),
    language,
    category,
    header:
      headerFormat === 'TEXT'
        ? { format: 'TEXT' as const, text: headerText, ...(headerHasVar ? { example: headerExample } : {}) }
        : isMediaHeader && media
          ? { format: headerFormat as MediaHeader, handle: media.handle }
          : undefined,
    body: { text: body, examples: bodyVars.map((_, i) => bodyExamples[i] ?? '') },
    footer: footer.trim() || undefined,
    buttons,
  };

  const previewComponents = useMemo(
    () => [
      ...(headerFormat === 'TEXT' ? [{ type: 'HEADER', format: 'TEXT', text: headerText }] : []),
      ...(isMediaHeader ? [{ type: 'HEADER', format: headerFormat }] : []),
      { type: 'BODY', text: body || 'Your message' },
      ...(footer ? [{ type: 'FOOTER', text: footer }] : []),
      ...(buttons.length
        ? [{
            type: 'BUTTONS',
            buttons: buttons.map((b) => ({ type: b.type, text: b.type === 'COPY_CODE' ? 'Copy code' : b.text || BUTTON_LABEL[b.type] })),
          }]
        : []),
    ],
    [headerFormat, headerText, isMediaHeader, body, footer, buttons],
  );

  async function pickFile(file: File | undefined) {
    if (!file || !isMediaHeader) return;
    if (!accountId) return setError('Choose the WhatsApp number first');
    setError('');
    setUploading(true);
    try {
      const res = await uploadFile<{ handle: string; fileName: string }>(
        `/api/templates/header-sample?whatsappAccountId=${accountId}`,
        file,
      );
      setMedia({
        handle: res.handle,
        fileName: res.fileName,
        previewUrl: headerFormat === 'IMAGE' ? URL.createObjectURL(file) : null,
      });
    } catch (err) {
      setMedia(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function updateButton(i: number, patch: Partial<TemplateButtonInput>) {
    setButtons((list) => list.map((b, j) => (j === i ? ({ ...b, ...patch } as TemplateButtonInput) : b)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (isMediaHeader && !media) return setError(`Upload a sample ${headerFormat.toLowerCase()} for the header`);
    const parsed = NewTemplateSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).join('. '));

    setSubmitting(true);
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Could not create the template');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const count = (type: TemplateButtonInput['type']) => buttons.filter((b) => b.type === type).length;
  const canAdd: Record<TemplateButtonInput['type'], boolean> = {
    QUICK_REPLY: buttons.length < 10,
    URL: buttons.length < 10 && count('URL') < 2,
    PHONE_NUMBER: buttons.length < 10 && count('PHONE_NUMBER') < 1,
    COPY_CODE: buttons.length < 10 && count('COPY_CODE') < 1 && category === 'MARKETING',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
      <form onSubmit={submit} className="bg-background rounded-lg w-full max-w-4xl shadow-xl">
        <div className="p-5 border-b">
          <h2 className="font-semibold">{copyOf ? `Duplicate "${copyOf.name}"` : 'New template'}</h2>
          <p className="text-xs text-muted-foreground">
            Meta reviews every template, usually within minutes. You can use it in campaigns once it&apos;s approved.
          </p>
        </div>

        <div className="grid md:grid-cols-[1fr_300px] gap-6 p-5">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">WhatsApp number</label>
                <select required value={accountId} onChange={(e) => { setAccountId(e.target.value); setMedia(null); }} className={field}>
                  <option value="">Choose a number…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}{a.displayPhoneNumber ? ` · ${a.displayPhoneNumber}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Template name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. diwali_offer_2026" className={field} />
                <p className="text-xs text-muted-foreground mt-1">Lowercase letters, numbers and underscores. Spaces become underscores.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                  <option value="MARKETING">Marketing: offers, announcements</option>
                  <option value="UTILITY">Utility: order and account updates</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                  {LANGUAGES.map(([code, label]) => (
                    <option key={code} value={code}>{label} ({code})</option>
                  ))}
                  {!LANGUAGES.some(([c]) => c === language) && <option value={language}>{language}</option>}
                </select>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Header <span className="text-muted-foreground font-normal">(optional)</span></legend>
              <div className="flex flex-wrap gap-1">
                {(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as HeaderChoice[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => { setHeaderFormat(f); setMedia(null); }}
                    className={`text-xs px-3 py-1.5 rounded-full border ${headerFormat === f ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
                  >
                    {f === 'NONE' ? 'None' : f.charAt(0) + f.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              {headerFormat === 'TEXT' && (
                <>
                  <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} placeholder="e.g. Hi {{1}}, your offer is here" className={field} />
                  {headerHasVar && (
                    <input value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} maxLength={60} placeholder="Example value for {{1}}, e.g. Priya" className={field} />
                  )}
                </>
              )}
              {isMediaHeader && (
                <div className="border border-dashed rounded-md p-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span className="text-primary">{media ? 'Replace sample file' : 'Upload a sample file'}</span>
                    <input
                      type="file"
                      className="sr-only"
                      accept={MEDIA_ACCEPT[headerFormat as MediaHeader].accept}
                      disabled={uploading}
                      onChange={(e) => pickFile(e.target.files?.[0])}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {media ? `Uploaded: ${media.fileName}. ` : ''}
                    {MEDIA_ACCEPT[headerFormat as MediaHeader].hint}. Meta uses it to review the template; you choose the actual file when sending a campaign.
                  </p>
                </div>
              )}
            </fieldset>

            <div>
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea
                required
                rows={5}
                maxLength={1024}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'Hi {{1}}, our Diwali sale is live! Use code {{2}} for 20% off.'}
                className={field}
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>
                  Add variables as {'{{1}}'}, {'{{2}}'}… You fill them per contact when sending.{' '}
                  <button type="button" className="text-primary" onClick={() => setBody((b) => `${b}{{${bodyVars.length + 1}}}`)}>
                    Add variable
                  </button>
                </span>
                <span>{body.length}/1024</span>
              </div>
              {bodyVars.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs font-medium">Example values (Meta needs these to review the template)</p>
                  {bodyVars.map((v, i) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="text-xs w-10 text-muted-foreground">{`{{${v}}}`}</span>
                      <input
                        value={bodyExamples[i] ?? ''}
                        onChange={(e) => setBodyExamples((ex) => { const next = [...ex]; next[i] = e.target.value; return next; })}
                        placeholder={i === 0 ? 'e.g. Priya' : 'Example value'}
                        className={field}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Footer <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} placeholder="e.g. Reply STOP to unsubscribe" className={field} />
            </div>

            <div>
              <p className="text-sm font-medium mb-1">Buttons <span className="text-muted-foreground font-normal">(optional, up to 10)</span></p>
              <div className="space-y-2">
                {buttons.map((b, i) => (
                  <div key={i} className="border rounded-md p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{BUTTON_LABEL[b.type]}</span>
                      <button type="button" aria-label="Remove button" onClick={() => setButtons((l) => l.filter((_, j) => j !== i))}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                    {b.type !== 'COPY_CODE' && (
                      <input value={b.text} maxLength={25} onChange={(e) => updateButton(i, { text: e.target.value })} placeholder="Button text" className={field} />
                    )}
                    {b.type === 'URL' && (
                      <>
                        <input value={b.url} onChange={(e) => updateButton(i, { url: e.target.value })} placeholder="https://yourshop.com/offer or https://yourshop.com/track/{{1}}" className={field} />
                        {placeholders(b.url).length > 0 && (
                          <input value={b.example ?? ''} onChange={(e) => updateButton(i, { example: e.target.value })} placeholder="Example value for {{1}} in the link" className={field} />
                        )}
                      </>
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <input value={b.phoneNumber} onChange={(e) => updateButton(i, { phoneNumber: e.target.value })} placeholder="+919876543210" className={field} />
                    )}
                    {b.type === 'COPY_CODE' && (
                      <input value={b.example} maxLength={20} onChange={(e) => updateButton(i, { example: e.target.value })} placeholder="Example coupon code, e.g. DIWALI20" className={field} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {(Object.keys(BUTTON_LABEL) as TemplateButtonInput['type'][]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={!canAdd[type]}
                    onClick={() => setButtons((l) => [...l, emptyButton(type)])}
                    className="flex items-center gap-1 text-xs border rounded-md px-2.5 py-1.5 hover:bg-muted disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3" /> {BUTTON_LABEL[type]}
                  </button>
                ))}
              </div>
              {category !== 'MARKETING' && <p className="text-xs text-muted-foreground mt-1">Copy-code buttons are only allowed in marketing templates.</p>}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Preview</p>
            <div className="md:sticky md:top-4">
              <TemplatePreview
                components={previewComponents}
                values={{ header: { '1': headerExample }, body: Object.fromEntries(bodyVars.map((v, i) => [v, bodyExamples[i] ?? ''])) }}
                mediaUrl={media?.previewUrl}
                mediaName={media?.fileName}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive px-5 pb-2">{error}</p>}
        <div className="flex justify-end gap-2 p-5 border-t">
          <button type="button" onClick={onClose} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={submitting || uploading} className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit to Meta for review'}
          </button>
        </div>
      </form>
    </div>
  );
}
