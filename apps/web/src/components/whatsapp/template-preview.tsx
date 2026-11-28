'use client';

import { ExternalLink, FileText, Image as ImageIcon, MapPin, Phone, Copy, Reply, Video } from 'lucide-react';
import { describeTemplate, fillText } from '@speediator/types';

interface Props {
  components: unknown;
  /** Values by placeholder name, per part: { header: {"1": "Priya"}, body: {...} }. */
  values?: { header?: Record<string, string>; body?: Record<string, string> };
  /** A local preview (object URL) or public link for the media header, when there is one. */
  mediaUrl?: string | null;
  mediaName?: string | null;
}

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText, LOCATION: MapPin } as const;

/** Renders the parts of a template so they highlight unfilled {{placeholders}}. */
function Text({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{/.test(p) ? (
          <span key={i} className="bg-amber-100 text-amber-900 rounded px-0.5">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** A WhatsApp-style bubble showing how the template will look to the customer. */
export function TemplatePreview({ components, values, mediaUrl, mediaName }: Props) {
  const t = describeTemplate(components);
  const Icon = t.headerFormat && t.headerFormat !== 'TEXT' ? MEDIA_ICON[t.headerFormat] : null;

  return (
    <div className="bg-[#efeae2] rounded-lg p-3">
      <div className="bg-white rounded-lg shadow-sm max-w-xs text-sm overflow-hidden">
        {Icon && (
          t.headerFormat === 'IMAGE' && mediaUrl ? (
            <img src={mediaUrl} alt="Header" className="w-full max-h-48 object-cover" />
          ) : (
            <div className="m-1.5 rounded bg-slate-100 h-28 flex flex-col items-center justify-center gap-1 text-slate-500">
              <Icon className="w-8 h-8" />
              <span className="text-xs px-2 text-center truncate max-w-full">
                {mediaName ?? `${(t.headerFormat ?? '').toLowerCase()} header`}
              </span>
            </div>
          )
        )}
        <div className="px-2.5 pt-2 pb-1.5 space-y-1">
          {t.headerText && (
            <p className="font-semibold"><Text text={fillText(t.headerText, values?.header ?? {})} /></p>
          )}
          <p className="whitespace-pre-wrap break-words"><Text text={fillText(t.body, values?.body ?? {})} /></p>
          {t.footer && <p className="text-xs text-slate-500">{t.footer}</p>}
        </div>
        {t.buttons.length > 0 && (
          <div className="border-t divide-y">
            {t.buttons.map((b, i) => {
              const BIcon = b.type === 'URL' ? ExternalLink : b.type === 'PHONE_NUMBER' ? Phone : b.type === 'COPY_CODE' ? Copy : Reply;
              return (
                <div key={i} className="flex items-center justify-center gap-1.5 py-2 text-[#027eb5] text-sm">
                  <BIcon className="w-3.5 h-3.5" /> {b.text}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Example values Meta stored with the template, for a realistic preview. */
export function exampleValues(components: unknown): { header: Record<string, string>; body: Record<string, string> } {
  const list = Array.isArray(components) ? (components as Array<Record<string, unknown>>) : [];
  const find = (type: string) => list.find((c) => String(c.type).toUpperCase() === type) as
    | { example?: { header_text?: string[]; body_text?: string[][] } }
    | undefined;
  const header = find('HEADER')?.example?.header_text ?? [];
  const body = find('BODY')?.example?.body_text?.[0] ?? [];
  const toMap = (arr: string[]) => Object.fromEntries(arr.map((v, i) => [String(i + 1), v]));
  return { header: toMap(header), body: toMap(body) };
}
