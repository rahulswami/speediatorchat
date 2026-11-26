// The API returns either { message } or Zod field errors shaped { field: [messages] }.
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const { message } = data as { message?: unknown };
  if (typeof message === 'string') return message;
  const fieldErrors = Object.values(data as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((v): v is string => typeof v === 'string');
  return fieldErrors[0] ?? fallback;
}
