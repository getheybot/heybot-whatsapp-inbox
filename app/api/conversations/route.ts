import { NextRequest, NextResponse } from 'next/server';
import { authorizeApi, jsonError } from '../../../lib/api';
import { listConversations } from '../../../lib/conversation-queries';

export const dynamic = 'force-dynamic';
const defaultLimit = 100;
const maxLimit = 100;

export async function GET(request: NextRequest) {
  const auth = await authorizeApi();
  if (auth.response) return auth.response;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam === null ? defaultLimit : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) return jsonError(400, `limit must be an integer from 1 to ${maxLimit}`);
  return NextResponse.json({ conversations: await listConversations(limit) }, { headers: auth.headers });
}
