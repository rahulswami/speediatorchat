import { fillDays, percent } from './overview.service';

describe('overview report helpers', () => {
  it('gives one entry per IST day, oldest first, with zeros for quiet days', () => {
    // 2026-11-28 20:00 UTC is already 29 Nov in India.
    const now = new Date('2026-11-28T20:00:00Z');
    const days = fillDays([{ day: '2026-11-28', inbound: 3, outbound: 5 }], 3, now);
    expect(days).toEqual([
      { day: '2026-11-27', inbound: 0, outbound: 0 },
      { day: '2026-11-28', inbound: 3, outbound: 5 },
      { day: '2026-11-29', inbound: 0, outbound: 0 },
    ]);
  });

  it('rounds rates and treats an empty base as 0%', () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });
});
