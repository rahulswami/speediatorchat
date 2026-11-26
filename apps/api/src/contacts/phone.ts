// Inbound webhooks give `messages[].from` as digits with country code and no "+"
// (e.g. 919876543210). Contacts added by hand must use the same shape, or the same
// person ends up as two contacts once they reply.
const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164 limit
const LOCAL_NUMBER_DIGITS = 10;

export function normalizePhone(raw: string, defaultCountryCode: string): string | null {
  let digits = raw.trim().replace(/[^\d+]/g, '');
  const hadPlus = digits.startsWith('+');
  digits = digits.replace(/\+/g, '');

  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
  // A leading 0 is the domestic trunk prefix (e.g. 09876543210 in India).
  else if (!hadPlus && digits.length === LOCAL_NUMBER_DIGITS + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (!hadPlus && digits.length === LOCAL_NUMBER_DIGITS) digits = defaultCountryCode + digits;

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS || digits.startsWith('0')) return null;
  return digits;
}
