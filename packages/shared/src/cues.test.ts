import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cueLabel, cueText, DEFAULT_CUES, defaultCues, MAX_CUE_LENGTH, MAX_CUES, normalizeCues } from './cues.ts';
import { DEFAULT_LANGUAGE, isLanguage, isRtl, LANGUAGE_CODES, languageName, LANGUAGES } from './languages.ts';

test('the languages, in the station\'s order', () => {
  assert.deepEqual(LANGUAGE_CODES, ['en', 'ku', 'ckb', 'ar']);
  assert.deepEqual(LANGUAGES.map((l) => l.name), ['English', 'Bahdini', 'Sorani', 'Arabic']);
  assert.deepEqual(LANGUAGES.map((l) => l.rtl), [false, true, true, true]);
  assert.ok(isLanguage(DEFAULT_LANGUAGE));
  assert.equal(languageName('ku'), 'Bahdini');
  assert.equal(languageName('tr'), 'tr', 'a language the station no longer offers keeps its code');
  assert.equal(isRtl('ku'), true);
  assert.equal(isRtl('en'), false);
  assert.equal(isRtl('tr'), false);
  assert.equal(isLanguage('tr'), false);
});

test('the station\'s own cues have a text in every language', () => {
  assert.equal(DEFAULT_CUES.length, 5);
  for (const cue of DEFAULT_CUES) for (const code of LANGUAGE_CODES) assert.ok(cue.text[code], `${cue.id} in ${code}`);
  assert.deepEqual(normalizeCues(defaultCues()), defaultCues(), 'and pass the check unchanged');
  assert.notEqual(defaultCues()[0], DEFAULT_CUES[0], 'a copy each time');
});

test('a cue goes out in the guest\'s language, else in English, else in what there is', () => {
  const cue = { id: 'x', text: { en: 'Wrap up', ckb: 'کۆتایی پێ بهێنە' } };
  assert.equal(cueText(cue, 'ckb'), 'کۆتایی پێ بهێنە');
  assert.equal(cueText(cue, 'ar'), 'Wrap up', 'no Arabic text: English');
  assert.equal(cueText(cue, undefined), 'Wrap up');
  assert.equal(cueText(cue, 'tr'), 'Wrap up');
  const kurdishOnly = { id: 'y', text: { ku: 'ب دوماهیک بینە' } };
  assert.equal(cueText(kurdishOnly, 'ar'), 'ب دوماهیک بینە');
  assert.equal(cueLabel(kurdishOnly), 'ب دوماهیک بینە');
  assert.equal(cueLabel(cue), 'Wrap up', 'the staff pages name a cue by its English text');
});

test('what is stored is made safe', () => {
  assert.deepEqual(normalizeCues(undefined), defaultCues(), 'nothing stored: the station\'s own');
  assert.deepEqual(normalizeCues('x'), defaultCues());
  assert.deepEqual(normalizeCues([]), [], 'an empty list stays empty');
  const messy = normalizeCues([
    { id: 'a', text: { en: '  One minute  ', tr: 'Bir dakika', ar: '' } },
    { id: 'a', text: { en: 'Same id' } },
    { id: 'Not An Id', text: { ku: 'باش' } },
    { id: 'empty', text: { en: '   ' } },
    { text: 'no' },
    null,
    { id: 'long', text: { en: 'x'.repeat(200) } },
  ]);
  assert.deepEqual(messy.map((c) => c.id), ['a', 'cue-2', 'cue-3', 'long']);
  assert.deepEqual(messy[0]!.text, { en: 'One minute' }, 'trimmed; a language the station does not have and an empty text are dropped');
  assert.equal(messy[3]!.text['en']!.length, MAX_CUE_LENGTH);
  assert.equal(normalizeCues(Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, text: { en: `cue ${i}` } }))).length, MAX_CUES);
});
