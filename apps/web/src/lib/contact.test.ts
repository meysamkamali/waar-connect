import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelLink, CHANNEL_LABELS, CHANNELS, initials } from './contact.ts';

test('a phone number opens the dialler, with its plus kept', () => {
  assert.equal(channelLink('phone', '+964 750 123 4567'), 'tel:+9647501234567');
  assert.equal(channelLink('phone', '0750-123 45 67'), 'tel:07501234567');
  assert.equal(channelLink('phone', 'ask his office'), undefined);
  assert.equal(channelLink('phone', '  '), undefined);
});

test('WhatsApp needs the international number; a local one gets no link', () => {
  assert.equal(channelLink('whatsapp', '+964 750 123 4567'), 'https://wa.me/9647501234567');
  assert.equal(channelLink('whatsapp', '00964 750 123 4567'), 'https://wa.me/9647501234567');
  assert.equal(channelLink('whatsapp', '0750 123 4567'), undefined, 'no country code: wa.me would go nowhere');
  assert.equal(channelLink('whatsapp', '+12'), undefined);
});

test('Telegram: a user name, with or without the at sign or the address; else an international number', () => {
  assert.equal(channelLink('telegram', '@dilan_ahmed'), 'https://t.me/dilan_ahmed');
  assert.equal(channelLink('telegram', 'dilan_ahmed'), 'https://t.me/dilan_ahmed');
  assert.equal(channelLink('telegram', 'https://t.me/dilan_ahmed'), 'https://t.me/dilan_ahmed');
  assert.equal(channelLink('telegram', '+964 750 123 4567'), 'https://t.me/+9647501234567');
  assert.equal(channelLink('telegram', 'ask in the group'), undefined);
  assert.equal(channelLink('telegram', '@ab'), undefined, 'too short for a user name');
});

test('Skype and email open their own apps; free text and "other" get no link', () => {
  assert.equal(channelLink('skype', 'live:dilan.ahmed'), 'skype:live:dilan.ahmed?chat');
  assert.equal(channelLink('skype', 'dilan ahmed'), undefined);
  assert.equal(channelLink('email', 'dilan@example.org'), 'mailto:dilan@example.org');
  assert.equal(channelLink('email', 'dilan at example'), undefined);
  assert.equal(channelLink('other', 'via the press office'), undefined);
  assert.deepEqual(Object.keys(CHANNEL_LABELS), [...CHANNELS]);
});

test('initials: the first letter of the first two words, in any script', () => {
  assert.equal(initials('Dilan Ahmed'), 'DA');
  assert.equal(initials('  rojin  '), 'R');
  assert.equal(initials('Azad Barzani Kamal'), 'AB');
  assert.equal(initials('دلان أحمد'), 'دأ');
  assert.equal(initials(''), '?');
});
