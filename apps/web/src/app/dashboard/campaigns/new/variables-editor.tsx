'use client';

import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  MEDIA_FORMATS,
  describeTemplate,
  type MediaFormat,
  type TemplateVariables,
  type VariableValue,
} from '@speediator/types';
import { TemplatePreview } from '@/components/whatsapp/template-preview';
import { MEDIA_ACCEPT, uploadFile } from '@/lib/upload';

type Source = 'static' | 'name' | 'phone' | 'attribute';

interface Props {
  components: unknown;
  whatsappAccountId: string;
  value: TemplateVariables;
  onChange: (next: TemplateVariables) => void;
}

const field = 'w-full border rounded-md px-3 py-2 text-sm bg-background';

const sourceOf = (v?: VariableValue): Source =>
  !v || v.source === 'static' ? 'static' : v.source === 'contact' ? v.field : 'attribute';

function valueFor(source: Source, prev?: VariableValue): VariableValue {
  const fallback = prev && prev.source !== 'static' ? prev.fallback : undefined;
  switch (source) {
    case 'static':
      return { source: 'static', value: '' };
    case 'name':
    case 'phone':
      return { source: 'contact', field: source, fallback };
    case 'attribute':
      return { source: 'attribute', key: '', fallback };
  }
}

/** What the preview shows for a variable: the fixed text, or a label for per-contact data. */
function sampleText(v?: VariableValue): string {
  if (!v) return '';
  if (v.source === 'static') return v.value;
  const label = v.source === 'contact' ? (v.field === 'name' ? 'Contact name' : 'Contact phone') : v.key || 'Contact field';
  return `[${label}]`;
}

/** Lets the sender fill each {{variable}} and the media header of the chosen template. */
export function VariablesEditor({ components, whatsappAccountId, value, onChange }: Props) {
  const shape = describeTemplate(components);
  const mediaFormat = shape.headerFormat && (MEDIA_FORMATS as readonly string[]).includes(shape.headerFormat)
    ? (shape.headerFormat as MediaFormat)
    : null;
  const [mediaMode, setMediaMode] = useState<'upload' | 'link'>(value.headerMedia?.link ? 'link' : 'upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [preview, setPreview] = useState<{ url: string | null; name: string | null }>({ url: null, name: null });

  const setSlot = (key: string, v: VariableValue) => onChange({ ...value, values: { ...value.values, [key]: v } });

  async function pickFile(file: File | undefined) {
    if (!file || !mediaFormat) return;
    setUploadError('');
    setUploading(true);
    try {
      const res = await uploadFile<{ id: string; fileName: string }>(`/api/whatsapp/accounts/${whatsappAccountId}/media`, file);
      onChange({ ...value, headerMedia: { id: res.id, ...(mediaFormat === 'DOCUMENT' ? { filename: res.fileName } : {}) } });
      setPreview({ url: mediaFormat === 'IMAGE' ? URL.createObjectURL(file) : null, name: res.fileName });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  if (!shape.slots.length && !mediaFormat) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">This template has no variables to fill.</p>
        <TemplatePreview components={components} />
      </div>
    );
  }

  const previewValues = {
    header: Object.fromEntries(shape.slots.filter((s) => s.component === 'header').map((s) => [s.name, sampleText(value.values[s.key])])),
    body: Object.fromEntries(shape.slots.filter((s) => s.component === 'body').map((s) => [s.name, sampleText(value.values[s.key])])),
  };

  return (
    <div className="space-y-4">
      {mediaFormat && (
        <div className="border rounded-md p-3 space-y-2">
          <p className="text-sm font-medium">Header {mediaFormat.toLowerCase()}</p>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mediaMode === 'upload'} onChange={() => { setMediaMode('upload'); onChange({ ...value, headerMedia: undefined }); }} />
              Upload a file
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mediaMode === 'link'} onChange={() => { setMediaMode('link'); onChange({ ...value, headerMedia: undefined }); setPreview({ url: null, name: null }); }} />
              Use a public link
            </label>
          </div>
          {mediaMode === 'upload' ? (
            <div>
              <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="text-primary">{value.headerMedia?.id ? 'Replace file' : 'Choose file'}</span>
                <input type="file" className="sr-only" accept={MEDIA_ACCEPT[mediaFormat].accept} disabled={uploading} onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                {value.headerMedia?.id && preview.name ? `Uploaded ${preview.name}. ` : ''}
                {MEDIA_ACCEPT[mediaFormat].hint}. WhatsApp keeps uploads for 30 days, so send within that time.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="url"
                value={value.headerMedia?.link ?? ''}
                onChange={(e) => {
                  const link = e.target.value.trim();
                  onChange({ ...value, headerMedia: link ? { link, ...(mediaFormat === 'DOCUMENT' && value.headerMedia?.filename ? { filename: value.headerMedia.filename } : {}) } : undefined });
                  setPreview({ url: mediaFormat === 'IMAGE' && link.startsWith('https://') ? link : null, name: null });
                }}
                placeholder="https://yourshop.com/banner.jpg"
                className={field}
              />
              {mediaFormat === 'DOCUMENT' && value.headerMedia?.link && (
                <input
                  value={value.headerMedia.filename ?? ''}
                  onChange={(e) => onChange({ ...value, headerMedia: { ...value.headerMedia!, filename: e.target.value || undefined } })}
                  placeholder="File name shown to customers, e.g. Price list.pdf"
                  className={field}
                />
              )}
              <p className="text-xs text-muted-foreground">The link must open the file directly, without a login.</p>
            </div>
          )}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      )}

      {shape.slots.map((slot) => {
        const v = value.values[slot.key];
        const source = sourceOf(v);
        return (
          <div key={slot.key} className="border rounded-md p-3 space-y-2">
            <p className="text-sm font-medium">{slot.label}</p>
            <select value={source} onChange={(e) => setSlot(slot.key, valueFor(e.target.value as Source, v))} className={field}>
              <option value="static">Same text for everyone</option>
              <option value="name">Contact&apos;s name</option>
              <option value="phone">Contact&apos;s phone number</option>
              <option value="attribute">Custom contact field</option>
            </select>
            {(!v || v.source === 'static') && (
              <input
                value={v?.source === 'static' ? v.value : ''}
                onChange={(e) => setSlot(slot.key, { source: 'static', value: e.target.value })}
                maxLength={slot.kind === 'coupon_code' ? 20 : 1024}
                placeholder={slot.kind === 'coupon_code' ? 'Coupon code, e.g. DIWALI20' : slot.kind === 'url' ? 'Text added to the end of the link' : 'Text to use'}
                className={field}
              />
            )}
            {v?.source === 'attribute' && (
              <input value={v.key} onChange={(e) => setSlot(slot.key, { ...v, key: e.target.value })} placeholder="Field name, e.g. city or order_id" className={field} />
            )}
            {v && v.source !== 'static' && (
              <div>
                <input
                  value={v.fallback ?? ''}
                  onChange={(e) => setSlot(slot.key, { ...v, fallback: e.target.value || undefined })}
                  placeholder="Default value, e.g. Customer"
                  className={field}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Used when a contact has no {v.source === 'contact' ? v.field : 'value for this field'}. Without it, those contacts are skipped and shown as failed.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
        <TemplatePreview components={components} values={previewValues} mediaUrl={preview.url} mediaName={preview.name} />
      </div>
    </div>
  );
}
