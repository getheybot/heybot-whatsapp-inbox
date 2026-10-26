'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today → time, yesterday → "Yesterday", older → date (e.g. 5/10/2026 in the viewer's locale). */
export function listDate(date: Date, now = new Date()) {
  if (sameDay(date, now)) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' });
}

// Formatted only in the browser so dates follow the viewer's timezone, not the server's.
export function ChatTime({ value, format }: { value: string; format: 'list' | 'time' }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(value);
  const label = !mounted ? '' : format === 'list'
    ? listDate(date) : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return <time dateTime={value} title={date.toISOString()}>{label}</time>;
}
