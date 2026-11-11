// A guest's contact details as the contact book shows them: which ways there are to reach them, and
// for each a link that opens it where the value is clear enough to make one.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export const CHANNELS = ['phone', 'whatsapp', 'telegram', 'skype', 'email', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = { phone: 'Phone', whatsapp: 'WhatsApp', telegram: 'Telegram', skype: 'Skype', email: 'Email', other: 'Other' };

/**
 * The address that opens this way of reaching the guest, or undefined when the value does not say
 * clearly enough where to go (a local number without a country code for WhatsApp, a free text).
 */
export function channelLink(channel: Channel, value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const digits = v.replace(/\D/g, '');
  switch (channel) {
    case 'phone':
      return digits.length >= 3 ? `tel:${v.startsWith('+') ? '+' : ''}${digits}` : undefined;
    case 'whatsapp': {
      // wa.me wants the full international number, digits only
      const international = v.startsWith('+') ? digits : v.startsWith('00') ? digits.slice(2) : '';
      return international.length >= 8 ? `https://wa.me/${international}` : undefined;
    }
    case 'telegram': {
      const handle = v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
      if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(handle)) return `https://t.me/${handle}`;
      return v.startsWith('+') && digits.length >= 8 ? `https://t.me/+${digits}` : undefined;
    }
    case 'skype':
      return /^[A-Za-z0-9._:,-]{3,}$/.test(v) ? `skype:${v}?chat` : undefined;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : undefined;
    default:
      return undefined;
  }
}

/** One or two letters for the round mark beside a name: the first letter of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? (Array.from(w)[0] ?? '') : '');
  return (first(words[0]) + first(words[1])).toUpperCase() || '?';
}
