import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function authHeaders() {
  const token = (await cookies()).get('access_token')?.value;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await authHeaders();
  if (!headers) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API_URL}/v1/campaigns/${id}`, { headers });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await authHeaders();
  if (!headers) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${API_URL}/v1/campaigns/${id}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = await authHeaders();
  if (!headers) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API_URL}/v1/campaigns/${id}`, { method: 'DELETE', headers });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
