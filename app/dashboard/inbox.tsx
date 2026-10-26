'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { contactInitials, contactLabel, MediaKind, MessagePreview } from '../../lib/message-preview';
import { ChatTime } from './chat-time';

type Message = { id: string; direction: string; deliveryStatus: string; at: string; preview: MessagePreview };
type Chat = { id: string; name: string | null; phone: string | null; unread: number; lastMessage: Message };
type Thread = {
  contact: { id: string; name: string | null; phone: string | null };
  status: 'open' | 'close';
  messages: Message[];
  nextCursor: string | null;
};

// Responses reused for the rest of the browser session; Refresh replaces them.
const listTtlMs = 30_000;
const cache: { chats?: { data: Chat[]; at: number }; threads: Map<string, Thread> } = { threads: new Map() };

class ApiError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new ApiError('Your session expired');
  }
  if (!response.ok) throw new ApiError((await response.json().catch(() => null))?.error ?? 'Request failed');
  return response.json();
}
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Could not reach the server';

const mediaPaths: Record<MediaKind, string> = {
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  audio: 'M9 4h6v9a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3',
  document: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  sticker: 'M4 4h11l5 5v11H4zM15 4v5h5M9 14a3.5 3.5 0 0 0 6 0',
  location: 'M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-.01',
  contacts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
};

function MediaIcon({ kind }: { kind: MediaKind }) {
  return <svg className="mediaIcon" viewBox="0 0 24 24" aria-hidden="true"><path d={mediaPaths[kind]} /></svg>;
}

function Avatar({ name, large }: { name: string | null; large?: boolean }) {
  const initials = contactInitials(name);
  return <span className={'avatar' + (large ? ' large' : '')} aria-hidden="true">
    {initials || <svg viewBox="0 0 24 24"><path d={mediaPaths.contacts} /></svg>}
  </span>;
}

function DeliveryTicks({ direction, status }: { direction: string; status: string }) {
  if (direction !== 'outbound') return null;
  if (status === 'failed') return <span className="ticks failed" title="Failed">!</span>;
  const read = status === 'read';
  return <span className={'ticks' + (read ? ' read' : '')} title={status}>{status === 'sent' ? '✓' : '✓✓'}</span>;
}

export function Inbox({ user }: { user: string }) {
  const selectedId = useSearchParams().get('contact');
  const [chats, setChats] = useState(cache.chats?.data);
  const [threads, setThreads] = useState(() => new Map(cache.threads));
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  // Refs block a second request before the loading state has re-rendered.
  const chatsInFlight = useRef(false);
  const threadsInFlight = useRef(new Set<string>());

  const loadChats = useCallback(async (force = false) => {
    if (chatsInFlight.current) return;
    if (!force && cache.chats && Date.now() - cache.chats.at < listTtlMs) return setChats(cache.chats.data);
    chatsInFlight.current = true;
    setIsLoadingChats(true);
    try {
      const { conversations } = await getJson<{ conversations: Chat[] }>('/api/conversations');
      cache.chats = { data: conversations, at: Date.now() };
      setChats(conversations);
      setError(undefined);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      chatsInFlight.current = false;
      setIsLoadingChats(false);
    }
  }, []);

  /** Loads the newest page, or with `before` the page of messages older than it. */
  const loadThread = useCallback(async (id: string, before?: string) => {
    if (threadsInFlight.current.has(id)) return;
    if (!before && cache.threads.has(id)) return;
    threadsInFlight.current.add(id);
    setLoadingThreads(new Set(threadsInFlight.current));
    try {
      const query = before ? `?limit=50&before=${encodeURIComponent(before)}` : '?limit=50';
      const page = await getJson<Thread>(`/api/conversations/${encodeURIComponent(id)}/messages${query}`);
      const cached = cache.threads.get(id);
      const thread = before && cached ? { ...page, messages: [...page.messages, ...cached.messages] } : page;
      cache.threads.set(id, thread);
      setThreads(new Map(cache.threads));
      setError(undefined);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      threadsInFlight.current.delete(id);
      setLoadingThreads(new Set(threadsInFlight.current));
    }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);
  useEffect(() => { if (selectedId) loadThread(selectedId); }, [selectedId, loadThread]);

  function refresh() {
    if (chatsInFlight.current) return;
    cache.threads.clear();
    setThreads(new Map());
    loadChats(true);
    if (selectedId) loadThread(selectedId);
  }

  function select(id: string | null, event: React.MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    // Shallow navigation: Next.js syncs useSearchParams without re-requesting the page.
    window.history.pushState(null, '', id ? `/dashboard?contact=${encodeURIComponent(id)}` : '/dashboard');
  }

  const thread = selectedId ? threads.get(selectedId) : undefined;
  const isLoadingThread = selectedId ? loadingThreads.has(selectedId) : false;
  const closed = thread?.status === 'close';

  return <div className={'inbox' + (selectedId ? ' hasThread' : '')}>
    <aside className="chatList">
      <header className="chatListHeader">
        <div className="chatListTitle">
          <h1>Chats</h1>
          <button type="button" className="refreshChats" onClick={refresh} disabled={isLoadingChats}
            aria-label="Refresh conversations" title="Refresh">↻</button>
        </div>
        <div className="chatListAccount">
          <Link href="/events">Events</Link>
          <span title={user}>{user}</span>
          <form action="/api/logout" method="post"><button>Sign out</button></form>
        </div>
      </header>
      {error && <div className="inboxError" role="alert">{error}</div>}
      <nav className="chats" aria-label="Conversations" aria-busy={isLoadingChats}>
        {chats?.map(chat => {
          const { preview } = chat.lastMessage;
          const active = selectedId === chat.id;
          return <a key={chat.id} href={`/dashboard?contact=${chat.id}`} onClick={event => select(chat.id, event)}
            className={'chatRow' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}>
            <Avatar name={chat.name} />
            <span className="chatRowBody">
              <span className="chatRowTop">
                <span className="chatName">{contactLabel(chat)}</span>
                <span className={'chatDate' + (chat.unread > 0 ? ' unread' : '')}>
                  <ChatTime value={chat.lastMessage.at} format="list" />
                </span>
              </span>
              <span className="chatRowBottom">
                <span className="chatPreview">
                  <DeliveryTicks direction={chat.lastMessage.direction} status={chat.lastMessage.deliveryStatus} />
                  {preview.media && <MediaIcon kind={preview.media} />}
                  <span className="chatPreviewText">{preview.text ?? preview.label}</span>
                </span>
                {chat.unread > 0 && <span className="unreadBadge">{chat.unread}</span>}
              </span>
            </span>
          </a>;
        })}
        {!chats && isLoadingChats && <div className="chatsEmpty">Loading conversations…</div>}
        {chats?.length === 0 && <div className="chatsEmpty">No conversations yet</div>}
      </nav>
    </aside>
    <main className="chatPane">
      {selectedId && !thread && <div className="threadStatus">{isLoadingThread || !error ? 'Loading messages…' : error}</div>}
      {thread && <>
        <header className="chatHeader">
          <a href="/dashboard" onClick={event => select(null, event)} className="chatBack" aria-label="Back to conversations">‹</a>
          <Avatar name={thread.contact.name} large />
          <div className="chatHeaderText">
            <h2>{contactLabel(thread.contact)}</h2>
            {thread.contact.name && thread.contact.phone && <p>+{thread.contact.phone}</p>}
          </div>
          {closed && <span className="closedBadge">Closed</span>}
        </header>
        <div className="messages" aria-busy={isLoadingThread}>
          <div className="messageList">
            {thread.nextCursor && <button type="button" className="loadEarlier" disabled={isLoadingThread}
              onClick={() => loadThread(thread.contact.id, thread.nextCursor!)}>
              {isLoadingThread ? 'Loading…' : 'Load earlier messages'}
            </button>}
            {thread.messages.map(message => {
              const { preview } = message;
              return <div key={message.id} className={'bubble ' + message.direction}>
                {preview.media && <div className="mediaPlaceholder"><MediaIcon kind={preview.media} /><span>{preview.label}</span></div>}
                {!preview.media && !preview.text && <div className="bubbleLabel">{preview.label}</div>}
                {preview.text && <div className="bubbleText">{preview.text}</div>}
                <div className="bubbleMeta">
                  <ChatTime value={message.at} format="time" />
                  <DeliveryTicks direction={message.direction} status={message.deliveryStatus} />
                </div>
              </div>;
            })}
          </div>
        </div>
        <footer className="composer">
          <input aria-label="Message" disabled={closed}
            placeholder={closed ? 'This conversation is closed' : 'Type a message'} />
          <button type="button" disabled title="Sending messages is not available yet">Send</button>
        </footer>
      </>}
    </main>
  </div>;
}
