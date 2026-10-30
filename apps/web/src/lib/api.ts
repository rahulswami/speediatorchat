const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new ApiError(res.status, body.message ?? 'Request failed');
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  auth: {
    register: (data: object) =>
      apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: object) =>
      apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    refresh: (refreshToken: string) =>
      apiFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  },
  invites: {
    accept: (data: object) =>
      apiFetch('/invites/accept', { method: 'POST', body: JSON.stringify(data) }),
  },
};
