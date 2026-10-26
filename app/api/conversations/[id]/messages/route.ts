import { NextRequest, NextResponse } from 'next/server';
import { authorizeApi, jsonError } from '../../../../../lib/api';
import { listContactMessages, parseId } from '../../../../../lib/conversation-queries';

export const dynamic = 'force-dynamic';
const maxLimit = 50;

/** `id` is the contact ID listed by /api/conversations; its conversations are read as one thread. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi();
  if (auth.response) return auth.response;
  const search = request.nextUrl.searchParams;
  const limitParam = search.get('limit');
  const limit = limitParam === null ? maxLimit : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) return jsonError(400, `limit must be an integer from 1 to ${maxLimit}`);
  const beforeParam = search.get('before');
  const before = beforeParam === null ? undefined : parseId(beforeParam);
  if (beforeParam !== null && before === undefined) return jsonError(400, 'before must be a message ID');
  const contactId = parseId((await params).id);
  if (contactId === undefined) return jsonError(404, 'Conversation not found');
  const thread = await listContactMessages(contactId, limit, before);
  if (!thread) return jsonError(404, 'Conversation not found');
  return NextResponse.json(thread, { headers: auth.headers });
}
