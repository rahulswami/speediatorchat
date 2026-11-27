import { z } from 'zod';

export const MAX_PICKED_CONTACTS = 5000;

/** Who a campaign goes to. Every mode is limited to opted-in contacts. */
export const AudienceFilterSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('tags'), tagIds: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ mode: z.literal('contacts'), contactIds: z.array(z.string().uuid()).min(1).max(MAX_PICKED_CONTACTS) }),
]);
export type AudienceFilter = z.infer<typeof AudienceFilterSchema>;

/**
 * Reads a stored filter, including campaigns saved before `mode` existed
 * ({} meant everyone, { tagIds } meant those tags). Anything unreadable falls back to a
 * filter that matches nobody rather than everybody.
 */
export function parseAudienceFilter(raw: unknown): AudienceFilter | null {
  const parsed = AudienceFilterSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const legacy = (raw ?? {}) as { tagIds?: unknown };
  if (raw && typeof raw === 'object' && Object.keys(raw).length === 0) return { mode: 'all' };
  if (Array.isArray(legacy.tagIds) && legacy.tagIds.length > 0) {
    return { mode: 'tags', tagIds: legacy.tagIds.filter((t): t is string => typeof t === 'string') };
  }
  return null;
}

/**
 * Prisma `where` for a campaign audience. Opt-in is part of every branch: marketing
 * templates may only go to contacts who opted in and have not opted out.
 */
export function audienceWhere(organizationId: string, raw: unknown) {
  const filter = parseAudienceFilter(raw);
  const base = { organizationId, optedIn: true, optedOut: false };
  if (!filter) return { ...base, id: { in: [] as string[] } };
  switch (filter.mode) {
    case 'all':
      return base;
    case 'tags':
      return { ...base, tagMap: { some: { tagId: { in: filter.tagIds } } } };
    case 'contacts':
      return { ...base, id: { in: filter.contactIds } };
  }
}
