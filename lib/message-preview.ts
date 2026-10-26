export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contacts';

export interface MessagePreview {
  /** Set for multimedia messages, which are rendered as a placeholder icon. */
  media?: MediaKind;
  /** Placeholder label, such as "Photo", shown when there is no text. */
  label?: string;
  text?: string;
}

const mediaLabels: Record<MediaKind, string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', document: 'Document',
  sticker: 'Sticker', location: 'Location', contacts: 'Contact',
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Describes a stored WhatsApp message item (inbound) or sent payload (outbound). */
export function describeMessage(messageType: string, content: unknown): MessagePreview {
  const message = record(content);
  const body = record(message[messageType]);
  switch (messageType) {
    case 'text':
      return { text: text(body.body) };
    case 'image': case 'video': case 'sticker':
      return { media: messageType, label: mediaLabels[messageType], text: text(body.caption) };
    case 'audio':
      return { media: 'audio', label: body.voice === true ? 'Voice message' : 'Audio' };
    case 'document':
      return { media: 'document', label: text(body.filename) ?? 'Document', text: text(body.caption) };
    case 'location':
      return { media: 'location', label: 'Location', text: text(body.name) ?? text(body.address) };
    case 'contacts':
      return { media: 'contacts', label: 'Contact' };
    case 'reaction':
      return { label: text(body.emoji) ? `Reacted ${body.emoji}` : 'Removed a reaction' };
    case 'button':
      return { text: text(body.text) };
    case 'interactive': {
      const reply = record(body.button_reply ?? body.list_reply);
      return { text: text(reply.title), label: 'Interactive message' };
    }
    case 'template':
      return { label: text(body.name) ? `Template: ${body.name}` : 'Template' };
    case 'unsupported':
      return { label: 'Unsupported message' };
    default:
      return { label: `${messageType || 'Unknown'} message` };
  }
}

export function contactLabel(contact: { name: string | null; phone: string | null }) {
  return contact.name?.trim() || (contact.phone ? `+${contact.phone}` : 'Unknown contact');
}

/** Up to two initials from the contact name; empty when the contact has no name. */
export function contactInitials(name: string | null) {
  const words = (name ?? '').split(/\s+/).map(word => Array.from(word).find(char => /\p{L}|\p{N}/u.test(char)))
    .filter((char): char is string => Boolean(char));
  if (words.length === 0) return '';
  return (words.length === 1 ? words[0] : words[0] + words[words.length - 1]).toUpperCase();
}
