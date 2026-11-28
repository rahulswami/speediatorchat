import { z } from 'zod';

/*
 * WhatsApp template components: reading the variables a template needs, building the
 * components Meta expects when creating one, and filling them in when sending.
 * Shapes follow Meta's template docs (developers.facebook.com/documentation/business-messaging/
 * whatsapp/templates/components and template-media).
 */

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
export type MediaFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export const MEDIA_FORMATS: readonly MediaFormat[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];

/** A component as Meta returns it (or as we submitted it). Fields we don't use are ignored. */
interface RawComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: RawButton[];
}

interface RawButton {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string | string[];
}

export interface TemplateSlot {
  /** Stable key used in a campaign's variable values, e.g. "body.1", "header.1", "button.0". */
  key: string;
  component: 'header' | 'body' | 'button';
  /** The placeholder's name: "1", "2", … or a named parameter such as "first_name". */
  name: string;
  buttonIndex?: number;
  kind: 'text' | 'url' | 'coupon_code';
  label: string;
}

export interface TemplateShape {
  headerFormat: HeaderFormat | null;
  headerText: string | null;
  body: string;
  footer: string | null;
  buttons: Array<{ type: string; text: string; url?: string; phoneNumber?: string; example?: string }>;
  slots: TemplateSlot[];
  /** Meta's "named" parameter format, detected from non-numeric placeholders. */
  named: boolean;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function placeholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1])) seen.push(m[1]);
  // Positional values are sent in number order, whatever order they appear in the text.
  return seen.every((n) => /^\d+$/.test(n)) ? seen.sort((a, b) => Number(a) - Number(b)) : seen;
}

function asComponents(raw: unknown): RawComponent[] {
  return Array.isArray(raw) ? (raw.filter((c) => c && typeof c === 'object') as RawComponent[]) : [];
}

const upper = (v: string | undefined) => (v ?? '').toUpperCase();

/** Reads a stored template's components into what a person filling it in needs to know. */
export function describeTemplate(components: unknown): TemplateShape {
  const list = asComponents(components);
  const header = list.find((c) => upper(c.type) === 'HEADER');
  const body = list.find((c) => upper(c.type) === 'BODY');
  const footer = list.find((c) => upper(c.type) === 'FOOTER');
  const buttons = list.find((c) => upper(c.type) === 'BUTTONS')?.buttons ?? [];

  const headerFormat = header ? ((upper(header.format) || 'TEXT') as HeaderFormat) : null;
  const headerText = headerFormat === 'TEXT' ? header?.text ?? '' : null;
  const slots: TemplateSlot[] = [];

  for (const name of placeholders(headerText)) {
    slots.push({ key: `header.${name}`, component: 'header', name, kind: 'text', label: `Header {{${name}}}` });
  }
  for (const name of placeholders(body?.text)) {
    slots.push({ key: `body.${name}`, component: 'body', name, kind: 'text', label: `Body {{${name}}}` });
  }
  buttons.forEach((b, i) => {
    const type = upper(b.type);
    if (type === 'URL') {
      for (const name of placeholders(b.url)) {
        slots.push({ key: `button.${i}`, component: 'button', name, buttonIndex: i, kind: 'url', label: `Link "${b.text ?? ''}" {{${name}}}` });
      }
    } else if (type === 'COPY_CODE') {
      slots.push({ key: `button.${i}`, component: 'button', name: 'coupon_code', buttonIndex: i, kind: 'coupon_code', label: 'Coupon code' });
    }
  });

  const names = slots.filter((s) => s.component !== 'button').map((s) => s.name);
  return {
    headerFormat,
    headerText,
    body: body?.text ?? '',
    footer: footer?.text ?? null,
    buttons: buttons.map((b) => ({
      type: upper(b.type),
      text: b.text ?? (upper(b.type) === 'COPY_CODE' ? 'Copy code' : ''),
      url: b.url,
      phoneNumber: b.phone_number,
      example: Array.isArray(b.example) ? b.example[0] : b.example,
    })),
    slots,
    named: names.some((n) => !/^\d+$/.test(n)),
  };
}

// ---------------------------------------------------------------------------------------------
// Campaign variable values
// ---------------------------------------------------------------------------------------------

export const CONTACT_FIELDS = ['name', 'phone'] as const;

export const VariableValueSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('static'), value: z.string().trim().max(1024) }),
  z.object({
    source: z.literal('contact'),
    field: z.enum(CONTACT_FIELDS),
    fallback: z.string().trim().max(1024).optional(),
  }),
  z.object({
    source: z.literal('attribute'),
    key: z.string().trim().min(1).max(100),
    fallback: z.string().trim().max(1024).optional(),
  }),
]);
export type VariableValue = z.infer<typeof VariableValueSchema>;

export const HeaderMediaSchema = z
  .object({
    link: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'Media link must start with https://').optional(),
    id: z.string().regex(/^\d+$/).optional(),
    filename: z.string().trim().max(240).optional(),
  })
  .refine((m) => !!m.link !== !!m.id, 'Give either an uploaded file or a link');
export type HeaderMedia = z.infer<typeof HeaderMediaSchema>;

export const TemplateVariablesSchema = z.object({
  values: z.record(z.string().max(120), VariableValueSchema).default({}),
  headerMedia: HeaderMediaSchema.optional(),
});
export type TemplateVariables = z.infer<typeof TemplateVariablesSchema>;

/** Older campaigns stored `{}` or a plain string map; anything unreadable means "no values". */
export function parseTemplateVariables(raw: unknown): TemplateVariables {
  const parsed = TemplateVariablesSchema.safeParse(raw);
  return parsed.success ? parsed.data : { values: {} };
}

/** Problems that make the campaign impossible to send to anyone. Empty means it's ready. */
export function variableProblems(components: unknown, vars: TemplateVariables): string[] {
  const shape = describeTemplate(components);
  const problems: string[] = [];
  for (const slot of shape.slots) {
    const v = vars.values[slot.key];
    if (!v) problems.push(`${slot.label} needs a value`);
    else if (v.source === 'static' && !v.value) problems.push(`${slot.label} needs a value`);
  }
  if (shape.headerFormat && (MEDIA_FORMATS as readonly string[]).includes(shape.headerFormat) && !vars.headerMedia) {
    problems.push(`The ${shape.headerFormat.toLowerCase()} header needs a file or link`);
  }
  if (shape.headerFormat === 'LOCATION') problems.push('Location headers are not supported yet');
  return problems;
}

export interface RecipientData {
  name: string | null;
  phone: string;
  attributes?: Record<string, string>;
}

export function resolveValue(v: VariableValue | undefined, r: RecipientData): string | null {
  if (!v) return null;
  if (v.source === 'static') return v.value || null;
  const own = v.source === 'contact' ? r[v.field] : r.attributes?.[v.key];
  const value = own?.trim() || v.fallback?.trim();
  return value || null;
}

export type SendComponent = Record<string, unknown>;

/**
 * The `components` array for a template send. `missing` lists placeholders this recipient has
 * no value for; Meta rejects the whole message (error 132000) if any are left out.
 */
export function buildSendComponents(
  components: unknown,
  vars: TemplateVariables,
  recipient: RecipientData,
): { components: SendComponent[]; missing: string[] } {
  const shape = describeTemplate(components);
  const missing: string[] = [];
  const out: SendComponent[] = [];

  const textParam = (slot: TemplateSlot) => {
    const text = resolveValue(vars.values[slot.key], recipient);
    if (text === null) missing.push(slot.label);
    return { type: 'text', text: text ?? '', ...(shape.named ? { parameter_name: slot.name } : {}) };
  };

  if (shape.headerFormat && (MEDIA_FORMATS as readonly string[]).includes(shape.headerFormat)) {
    const media = vars.headerMedia;
    if (!media) missing.push(`${shape.headerFormat.toLowerCase()} header`);
    else {
      const type = shape.headerFormat.toLowerCase();
      const object: Record<string, string> = media.id ? { id: media.id } : { link: media.link! };
      if (type === 'document' && media.filename) object.filename = media.filename;
      out.push({ type: 'header', parameters: [{ type, [type]: object }] });
    }
  }
  const headerSlots = shape.slots.filter((s) => s.component === 'header');
  if (headerSlots.length) out.push({ type: 'header', parameters: headerSlots.map(textParam) });

  const bodySlots = shape.slots.filter((s) => s.component === 'body');
  if (bodySlots.length) out.push({ type: 'body', parameters: bodySlots.map(textParam) });

  for (const slot of shape.slots.filter((s) => s.component === 'button')) {
    const value = resolveValue(vars.values[slot.key], recipient);
    if (value === null) missing.push(slot.label);
    out.push(
      slot.kind === 'coupon_code'
        ? { type: 'button', sub_type: 'copy_code', index: slot.buttonIndex, parameters: [{ type: 'coupon_code', coupon_code: value ?? '' }] }
        : { type: 'button', sub_type: 'url', index: String(slot.buttonIndex), parameters: [{ type: 'text', text: value ?? '' }] },
    );
  }

  return { components: out, missing };
}

/** Text with placeholders replaced, for previews. Unfilled ones stay as {{n}}. */
export function fillText(text: string, values: Record<string, string | null | undefined>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => values[name] || whole);
}

// ---------------------------------------------------------------------------------------------
// Creating templates
// ---------------------------------------------------------------------------------------------

const buttonText = z.string().trim().min(1).max(25);

export const TemplateButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: buttonText }),
  z.object({
    type: z.literal('URL'),
    text: buttonText,
    url: z.string().trim().url().max(2000),
    example: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal('PHONE_NUMBER'),
    text: buttonText,
    phoneNumber: z.string().trim().regex(/^\+?\d{6,20}$/, 'Phone number: digits only, with country code'),
  }),
  z.object({ type: z.literal('COPY_CODE'), example: z.string().trim().min(1).max(20) }),
]);
export type TemplateButtonInput = z.infer<typeof TemplateButtonSchema>;

export const TemplateHeaderSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('TEXT'), text: z.string().trim().min(1).max(60), example: z.string().trim().max(60).optional() }),
  z.object({ format: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']), handle: z.string().min(1) }),
]);
export type TemplateHeaderInput = z.infer<typeof TemplateHeaderSchema>;

export const NewTemplateSchema = z
  .object({
    whatsappAccountId: z.string().uuid(),
    name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, 'Name: lowercase letters, digits and underscores only'),
    language: z.string().trim().min(2).max(10),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    header: TemplateHeaderSchema.optional(),
    body: z.object({
      text: z.string().trim().min(1).max(1024),
      examples: z.array(z.string().trim().min(1).max(200)).default([]),
    }),
    footer: z.string().trim().max(60).optional(),
    buttons: z.array(TemplateButtonSchema).max(10).default([]),
  })
  .superRefine((t, ctx) => {
    for (const problem of newTemplateProblems(t)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
export type NewTemplateInput = z.infer<typeof NewTemplateSchema>;

const sequential = (names: string[]) => names.every((n, i) => n === String(i + 1));

function newTemplateProblems(t: {
  header?: TemplateHeaderInput;
  body: { text: string; examples: string[] };
  footer?: string;
  buttons: TemplateButtonInput[];
  category: string;
}): string[] {
  const problems: string[] = [];
  const bodyVars = placeholders(t.body.text);
  if (!sequential(bodyVars)) problems.push('Body variables must be numbered {{1}}, {{2}}, {{3}}… in order');
  if (t.body.examples.length !== bodyVars.length) {
    problems.push(`Give one example value for each body variable (${bodyVars.length} needed)`);
  }
  if (t.header?.format === 'TEXT') {
    const headerVars = placeholders(t.header.text);
    if (headerVars.length > 1 || (headerVars.length === 1 && headerVars[0] !== '1')) {
      problems.push('The header can have one variable, written {{1}}');
    }
    if (headerVars.length === 1 && !t.header.example) problems.push('Give an example value for the header variable');
  }
  if (t.footer && placeholders(t.footer).length) problems.push('The footer cannot contain variables');

  const count = (type: string) => t.buttons.filter((b) => b.type === type).length;
  if (count('URL') > 2) problems.push('A template can have at most 2 website buttons');
  if (count('PHONE_NUMBER') > 1) problems.push('A template can have only 1 call button');
  if (count('COPY_CODE') > 1) problems.push('A template can have only 1 copy-code button');
  if (count('COPY_CODE') && t.category !== 'MARKETING') problems.push('Copy-code buttons are only allowed in marketing templates');
  for (const b of t.buttons) {
    if (b.type !== 'URL') continue;
    const urlVars = placeholders(b.url);
    if (urlVars.length > 1 || (urlVars.length === 1 && (urlVars[0] !== '1' || !b.url.trimEnd().endsWith('}}')))) {
      problems.push(`Website button "${b.text}": the link can have one variable, {{1}}, at the very end`);
    } else if (urlVars.length === 1 && !b.example) {
      problems.push(`Website button "${b.text}": give an example value for {{1}}`);
    }
  }
  return problems;
}

/** Meta wants quick replies grouped together, so they always go first. */
export function orderButtons(buttons: TemplateButtonInput[]): TemplateButtonInput[] {
  return [...buttons.filter((b) => b.type === 'QUICK_REPLY'), ...buttons.filter((b) => b.type !== 'QUICK_REPLY')];
}

/** The `components` array for POST /{WABA_ID}/message_templates. */
export function buildCreateComponents(t: NewTemplateInput): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (t.header?.format === 'TEXT') {
    out.push({
      type: 'HEADER',
      format: 'TEXT',
      text: t.header.text,
      ...(placeholders(t.header.text).length ? { example: { header_text: [t.header.example] } } : {}),
    });
  } else if (t.header) {
    out.push({ type: 'HEADER', format: t.header.format, example: { header_handle: [t.header.handle] } });
  }

  out.push({
    type: 'BODY',
    text: t.body.text,
    ...(t.body.examples.length ? { example: { body_text: [t.body.examples] } } : {}),
  });
  if (t.footer) out.push({ type: 'FOOTER', text: t.footer });

  if (t.buttons.length) {
    out.push({
      type: 'BUTTONS',
      buttons: orderButtons(t.buttons).map((b) => {
        switch (b.type) {
          case 'QUICK_REPLY':
            return { type: 'QUICK_REPLY', text: b.text };
          case 'URL':
            return { type: 'URL', text: b.text, url: b.url, ...(placeholders(b.url).length ? { example: [b.example] } : {}) };
          case 'PHONE_NUMBER':
            return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneNumber.replace(/^\+/, '') };
          case 'COPY_CODE':
            return { type: 'COPY_CODE', example: b.example };
        }
      }),
    });
  }
  return out;
}

/**
 * Turns a stored template back into form values, for "duplicate". Media headers come back
 * without a file: Meta's upload handle can't be reused, so the person picks the file again.
 */
export function templateToFormValues(components: unknown): {
  header: { format: HeaderFormat | 'NONE'; text: string; example: string };
  body: string;
  bodyExamples: string[];
  footer: string;
  buttons: TemplateButtonInput[];
} {
  const list = asComponents(components);
  const shape = describeTemplate(components);
  const rawHeader = list.find((c) => upper(c.type) === 'HEADER') as (RawComponent & { example?: { header_text?: string[] } }) | undefined;
  const rawBody = list.find((c) => upper(c.type) === 'BODY') as (RawComponent & { example?: { body_text?: string[][] } }) | undefined;

  const buttons: TemplateButtonInput[] = shape.buttons.flatMap((b): TemplateButtonInput[] => {
    switch (b.type) {
      case 'QUICK_REPLY':
        return [{ type: 'QUICK_REPLY', text: b.text }];
      case 'URL':
        return [{ type: 'URL', text: b.text, url: b.url ?? '', example: b.example }];
      case 'PHONE_NUMBER':
        return [{ type: 'PHONE_NUMBER', text: b.text, phoneNumber: `+${(b.phoneNumber ?? '').replace(/^\+/, '')}` }];
      case 'COPY_CODE':
        return [{ type: 'COPY_CODE', example: b.example ?? '' }];
      default:
        return [];
    }
  });

  return {
    header: {
      format: shape.headerFormat ?? 'NONE',
      text: shape.headerText ?? '',
      example: rawHeader?.example?.header_text?.[0] ?? '',
    },
    body: shape.body,
    bodyExamples: rawBody?.example?.body_text?.[0] ?? [],
    footer: shape.footer ?? '',
    buttons,
  };
}
