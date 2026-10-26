import { NextResponse } from 'next/server';
import { getUser } from './auth';

const headers = { 'Cache-Control': 'private, no-store' };

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers });
}

/** Authenticated user's email, or the 401 response to return. */
export async function authorizeApi() {
  const email = await getUser();
  if (!email) return { response: jsonError(401, 'Unauthorized') };
  return { email, headers };
}
