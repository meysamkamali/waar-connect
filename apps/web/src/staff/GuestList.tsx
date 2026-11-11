// The guests seated in a studio, with their links: beside the door in the producer's room. One line
// adds a guest: typing a name finds contacts to seat, or seats that name as a guest of its own. Each
// seated guest shows where they are right now, their link to copy, and the way to take them off.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { useEffect, useState } from 'preact/hooks';
import { ApiError, createInvite, deleteGuest, listContacts, seatGuest, type Contact, type GuestRecord, type RoomSnapshot } from '../api.ts';
import { ArmButton, CopyButton, Icon, Info } from '../components/ui.tsx';
import { initials } from '../lib/contact.ts';
import { LANGUAGES } from './Contacts.tsx';

type Tone = 'ok' | 'warn' | 'bad' | '';

/** Where a seated guest is right now, in a word. */
function whereIs(g: GuestRecord, snap: RoomSnapshot | null): { text: string; tone: Tone } {
  if (!snap?.connected.includes(g.identity)) return { text: 'offline', tone: '' };
  const s = snap.guests.find((x) => x.identity === g.identity);
  if (!s || s.place === 'lobby') return { text: 'at the door', tone: 'warn' };
  if (s.place === 'green') return { text: 'green room', tone: 'ok' };
  if (s.place === 'studio') return s.tally === 'onair' ? { text: 'on air', tone: 'bad' } : { text: 'studio', tone: 'ok' };
  return { text: 'left', tone: '' };
}

const reachLine = (c: Contact) => [c.phone, c.whatsapp && `WhatsApp ${c.whatsapp}`, c.telegram && `Telegram ${c.telegram}`, c.skype && `Skype ${c.skype}`, c.email].filter(Boolean).join(' · ');

export function GuestList({ pcrId, guests, snapshot, onChanged, onError }: { pcrId: string; guests: GuestRecord[]; snapshot: RoomSnapshot | null; onChanged: () => Promise<void> | void; onError: (m: string) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Contact[]>([]);
  const [lang, setLang] = useState('ku');
  const [busy, setBusy] = useState(false);
  const typed = query.trim();

  useEffect(() => {
    if (!typed) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => void listContacts(typed).then((r) => setFound(r.contacts.slice(0, 6))).catch(() => setFound([])), 200);
    return () => clearTimeout(timer);
  }, [typed]);

  const fail = (err: unknown) => onError(err instanceof ApiError ? err.message : String(err));
  const seatedContacts = new Set(guests.map((g) => g.contactId).filter((c): c is string => c !== null));

  function seat(body: { contactId: string } | { displayName: string; language: string }): void {
    setBusy(true);
    seatGuest(pcrId, body)
      .then(({ guest }) => (guest.invites?.length ? undefined : createInvite(guest.id)))
      .then(() => {
        setQuery('');
        return onChanged();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  return (
    <div class="gl">
      <div class="gl-head">
        <h3>
          Guests
          <span class="lane-count">{guests.length}</span>
          <Info side="start" text="Everyone seated in this studio. Type a name to seat a contact from the book or a guest of their own; each gets a link to open on their phone. A guest shows at the door once they open it." />
        </h3>
        <a class="chip" href="/app/contacts" title="Open the contact book">
          <Icon name="user" /> Book
        </a>
      </div>

      <form
        class="gl-add"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter seats the typed name only when no contact matches: a contact is seated by its own button
          if (typed && found.length === 0 && !busy) seat({ displayName: typed, language: lang });
        }}
      >
        <label class="ct-search">
          <Icon name="plus" />
          <input placeholder="Add a guest" aria-label="Add a guest: a contact's name, or a new name" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        </label>
        {typed && (
          <div class="gl-results">
            {found.map((c) => (
              <div class="gl-result" key={c.id}>
                <span class="gl-name-block">
                  <strong dir="auto">{c.displayName}</strong>
                  <small dir="ltr">{reachLine(c) || 'no contact details'}</small>
                </span>
                {seatedContacts.has(c.id) ? (
                  <span class="gl-where ok">seated</span>
                ) : (
                  <button type="button" class="btn secondary small" disabled={busy} onClick={() => seat({ contactId: c.id })}>
                    Seat
                  </button>
                )}
              </div>
            ))}
            <div class="gl-result new">
              <span class="gl-name-block">
                <strong dir="auto">{typed}</strong>
                <small>a guest of their own</small>
              </span>
              <select aria-label="Language of the guest's page" value={lang} onChange={(e) => setLang((e.currentTarget as HTMLSelectElement).value)}>
                {LANGUAGES.map(([code, label]) => (
                  <option value={code} key={code}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" class="btn secondary small" disabled={busy} onClick={() => seat({ displayName: typed, language: lang })}>
                Seat
              </button>
            </div>
          </div>
        )}
      </form>

      {guests.length === 0 && !typed && <div class="room-empty">No guest seated</div>}
      {guests.map((g) => {
        const where = whereIs(g, snapshot);
        const link = g.invites[0]?.url;
        return (
          <div class="gl-row" key={g.id}>
            <span class="ct-avatar" aria-hidden="true">
              {initials(g.displayName)}
            </span>
            <span class="gl-name-block">
              <strong dir="auto">{g.displayName}</strong>
              <span class={`gl-where ${where.tone}`}>{where.text}</span>
            </span>
            <span class="gl-tools">
              {link ? (
                <CopyButton text={link} label="Copy the guest's link" iconOnly />
              ) : (
                <button class="chip" title="Make a link" aria-label="Make a link" onClick={() => void createInvite(g.id).then(onChanged).catch(fail)}>
                  <Icon name="link" />
                </button>
              )}
              <ArmButton label={`Remove ${g.displayName} and their link`} ask="Remove?" icon="trash" iconOnly onConfirm={() => void deleteGuest(g.id).then(onChanged).catch(fail)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
