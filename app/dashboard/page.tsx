import { Suspense } from 'react';
import { requireUser } from '../../lib/auth';
import { Inbox } from './inbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Heybot - WhatsApp Inbox' };

// Conversations and messages are loaded in the browser from /api/conversations.
export default async function Dashboard() {
  const user = await requireUser();
  return <Suspense><Inbox user={user} /></Suspense>;
}
