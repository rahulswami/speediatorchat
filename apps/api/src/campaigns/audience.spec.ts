import { AudienceFilterSchema, audienceWhere, parseAudienceFilter } from '@speediator/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('audienceWhere', () => {
  it('always limits to the organization and to opted-in, not opted-out contacts', () => {
    for (const filter of [{ mode: 'all' }, { mode: 'tags', tagIds: [A] }, { mode: 'contacts', contactIds: [B] }]) {
      expect(audienceWhere('org-1', filter)).toMatchObject({ organizationId: 'org-1', optedIn: true, optedOut: false });
    }
  });

  it('narrows by tags or picked contacts', () => {
    expect(audienceWhere('o', { mode: 'tags', tagIds: [A] })).toMatchObject({ tagMap: { some: { tagId: { in: [A] } } } });
    expect(audienceWhere('o', { mode: 'contacts', contactIds: [B] })).toMatchObject({ id: { in: [B] } });
  });

  it('reads filters saved before audience modes existed', () => {
    expect(parseAudienceFilter({})).toEqual({ mode: 'all' });
    expect(parseAudienceFilter({ tagIds: [A] })).toEqual({ mode: 'tags', tagIds: [A] });
  });

  it('matches nobody, not everybody, when a stored filter is unreadable', () => {
    expect(audienceWhere('o', { mode: 'tags', tagIds: [] })).toMatchObject({ id: { in: [] } });
    expect(audienceWhere('o', 'garbage')).toMatchObject({ id: { in: [] } });
  });
});

describe('AudienceFilterSchema', () => {
  it('rejects empty selections and non-UUID ids', () => {
    expect(AudienceFilterSchema.safeParse({ mode: 'contacts', contactIds: [] }).success).toBe(false);
    expect(AudienceFilterSchema.safeParse({ mode: 'tags', tagIds: ['not-a-uuid'] }).success).toBe(false);
    expect(AudienceFilterSchema.safeParse({ mode: 'everyone' }).success).toBe(false);
  });
});
