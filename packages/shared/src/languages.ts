// The languages a guest's page can be in, in the station's order: English, Bahdini, Sorani, Arabic.
// A guest's language is chosen when they are seated; their page, and the cues sent to it, follow it.
// The code `ku` is Kurdish as the station writes it: Bahdini, in Arabic letters, right to left.
// (Until 2026-11-11 the same code stood for Kurmanji in Latin letters.)
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export interface Language {
  code: string;
  /** As the staff pages say it. */
  name: string;
  /** As its speakers write it. */
  native: string;
  /** Written right to left. */
  rtl: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', native: 'English', rtl: false },
  { code: 'ku', name: 'Bahdini', native: 'بادینی', rtl: true },
  { code: 'ckb', name: 'Sorani', native: 'سۆرانی', rtl: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
];

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

/** A new guest's language unless another is chosen: the station's own. */
export const DEFAULT_LANGUAGE = 'ku';

export function isLanguage(code: unknown): code is string {
  return typeof code === 'string' && LANGUAGE_CODES.includes(code);
}

/** The language's name for the staff pages; the code itself for one the station no longer offers. */
export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function isRtl(code: string): boolean {
  return LANGUAGES.find((l) => l.code === code)?.rtl ?? false;
}
