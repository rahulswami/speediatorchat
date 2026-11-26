import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+91 98765 43210', '919876543210'],
    ['919876543210', '919876543210'],
    ['9876543210', '919876543210'],
    ['09876543210', '919876543210'],
    ['0091-98765-43210', '919876543210'],
    ['(98765) 43210', '919876543210'],
    ['+1 (415) 555-0100', '14155550100'],
  ])('turns %s into %s', (raw, expected) => {
    expect(normalizePhone(raw, '91')).toBe(expected);
  });

  it('uses the given country code for 10-digit local numbers', () => {
    expect(normalizePhone('4155550100', '1')).toBe('14155550100');
  });

  it.each(['', 'abc', '12345', '+1234567890123456', '0000000000000'])('rejects %p', (raw) => {
    expect(normalizePhone(raw, '91')).toBeNull();
  });
});
