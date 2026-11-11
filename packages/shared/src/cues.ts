// The producer's ready-made cues for a guest's screen ("30 seconds", "Wrap up"). Each cue has its
// text in every language of the station; a guest gets it in the language of their page. The admin
// edits the list for the whole station; this is the list a station starts with.
// The Kurdish and Arabic texts were written by the assistant and need a native speaker's eye.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { LANGUAGE_CODES } from './languages.ts';

export interface Cue {
  id: string;
  /** The cue by language code. */
  text: Record<string, string>;
}

export const MAX_CUES = 24;
export const MAX_CUE_LENGTH = 80;

export const DEFAULT_CUES: readonly Cue[] = [
  { id: 'seconds', text: { en: '30 seconds', ku: '30 چرکە', ckb: '30 چرکە', ar: '30 ثانية' } },
  { id: 'wrap', text: { en: 'Wrap up', ku: 'ب دوماهیک بینە', ckb: 'کۆتایی پێ بهێنە', ar: 'اختم حديثك' } },
  { id: 'camera', text: { en: 'Look at the camera', ku: 'بەرێ خۆ بدە کامێرایێ', ckb: 'سەیری کامێراکە بکە', ar: 'انظر إلى الكاميرا' } },
  { id: 'louder', text: { en: 'Speak louder', ku: 'ب دەنگەکێ بلندتر باخڤە', ckb: 'بە دەنگێکی بەرزتر قسە بکە', ar: 'ارفع صوتك' } },
  { id: 'next', text: { en: 'You are next', ku: 'پشتی ڤێ نۆرا تەیە', ckb: 'دوای ئەمە نۆرەی تۆیە', ar: 'أنت التالي' } },
];

export const defaultCues = (): Cue[] => DEFAULT_CUES.map((c) => ({ id: c.id, text: { ...c.text } }));

const firstText = (cue: Cue): string => LANGUAGE_CODES.map((code) => cue.text[code]).find((t) => t) ?? Object.values(cue.text).find((t) => t) ?? '';

/** The cue as the staff pages name it: its English text, or the first text it has. */
export function cueLabel(cue: Cue): string {
  return cue.text['en'] || firstText(cue);
}

/** The cue as it goes to a guest: in their language; without a text in it, in English; else whatever there is. */
export function cueText(cue: Cue, language: string | undefined): string {
  return (language ? cue.text[language] : undefined) || cue.text['en'] || firstText(cue);
}

/**
 * A list of cues as stored or sent, made safe: only the station's languages, texts trimmed and cut
 * to length, a cue without any text dropped, ids unique. Something that is no list gives the
 * station's own cues; an empty list stays empty (a station may want none).
 */
export function normalizeCues(input: unknown): Cue[] {
  if (!Array.isArray(input)) return defaultCues();
  const out: Cue[] = [];
  const taken = new Set<string>();
  for (const raw of input as unknown[]) {
    if (out.length >= MAX_CUES) break;
    if (!raw || typeof raw !== 'object') continue;
    const given = (raw as { text?: unknown }).text;
    if (!given || typeof given !== 'object') continue;
    const text: Record<string, string> = {};
    for (const code of LANGUAGE_CODES) {
      const t = (given as Record<string, unknown>)[code];
      if (typeof t === 'string' && t.trim()) text[code] = t.trim().slice(0, MAX_CUE_LENGTH);
    }
    if (Object.keys(text).length === 0) continue;
    let id = (raw as { id?: unknown }).id;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,24}$/.test(id) || taken.has(id)) {
      let n = out.length + 1;
      while (taken.has(`cue-${n}`)) n++;
      id = `cue-${n}`;
    }
    taken.add(id as string);
    out.push({ id: id as string, text });
  }
  return out;
}
