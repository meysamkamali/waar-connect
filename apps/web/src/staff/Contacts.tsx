// The guest contact book: how to reach each guest (phone, WhatsApp, Telegram, Skype, email, other).
// Producers and admins edit; engineers read. Each way of reaching a guest opens its own app where the
// value is clear enough to make a link (lib/contact.ts).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, createContact, deleteContact, listContacts, updateContact, type Contact, type ContactInput, type User } from '../api.ts';
import { Icon, Info, type IconName } from '../components/ui.tsx';
import { CHANNEL_LABELS, channelLink, CHANNELS, initials, type Channel } from '../lib/contact.ts';
import { DEFAULT_LANGUAGE, languageName, LANGUAGES as STATION_LANGUAGES } from '@waar-connect/shared';

/** The station's languages in its order, as [code, label] for the pickers. */
export const LANGUAGES: ReadonlyArray<[string, string]> = STATION_LANGUAGES.map((l) => [l.code, l.native === l.name ? l.name : `${l.name} · ${l.native}`]);

const CHANNEL_ICONS: Readonly<Record<Channel, IconName>> = { phone: 'phone', whatsapp: 'message', telegram: 'send', skype: 'camera', email: 'mail', other: 'user' };

const empty = (): ContactInput => ({ displayName: '', language: DEFAULT_LANGUAGE, phone: '', whatsapp: '', telegram: '', skype: '', email: '', other: '', notes: '', casparName: '' });

function ContactForm({ title, initial, onSave, onCancel, saving }: { title: string; initial: ContactInput; onSave: (c: ContactInput) => void; onCancel: () => void; saving: boolean }) {
  const [c, setC] = useState<ContactInput>(initial);
  // from the state as it is now: a browser that fills several fields at once fires their events together
  const set = (key: keyof ContactInput, value: string) => setC((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      class="adm-card ct-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!c.displayName.trim()) return;
        onSave({ ...c, displayName: c.displayName.trim() });
      }}
    >
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>{title}</h2>
        </div>
        <div class="adm-actions">
          <button class="btn secondary small" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button class="btn small" type="submit" disabled={saving || !c.displayName.trim()}>
            <Icon name="check" />
            Save
          </button>
        </div>
      </header>
      <div class="adm-fields">
        <label class="span-2">
          Name
          <input required autoFocus value={c.displayName} onInput={(e) => set('displayName', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <div class="adm-field">
          <span class="adm-inline">
            Name on screen
            <Info text="The name as it goes on the lower third when the guest is on air." />
          </span>
          <input value={c.casparName ?? ''} onInput={(e) => set('casparName', (e.currentTarget as HTMLInputElement).value)} />
        </div>
        <label>
          Language
          <select value={c.language ?? DEFAULT_LANGUAGE} onChange={(e) => set('language', (e.currentTarget as HTMLSelectElement).value)}>
            {LANGUAGES.map(([code, label]) => (
              <option value={code} key={code}>
                {label}
              </option>
            ))}
            {/* a language the station no longer offers stays as it is until another is picked */}
            {c.language && !LANGUAGES.some(([code]) => code === c.language) && <option value={c.language}>{c.language}</option>}
          </select>
        </label>
        {CHANNELS.map((key) => (
          <label key={key}>
            {CHANNEL_LABELS[key]}
            <input value={(c[key] as string | null | undefined) ?? ''} onInput={(e) => set(key, (e.currentTarget as HTMLInputElement).value)} />
          </label>
        ))}
        <label class="span-all">
          Notes
          <textarea rows={2} value={c.notes ?? ''} onInput={(e) => set('notes', (e.currentTarget as HTMLTextAreaElement).value)} />
        </label>
      </div>
    </form>
  );
}

function ContactRow({ c, canEdit, onEdit, onRemove }: { c: Contact; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const reach = CHANNELS.map((key) => ({ key, value: (c[key] ?? '').trim() })).filter((x) => x.value);
  return (
    <article class="ct-row">
      <span class="ct-avatar" aria-hidden="true">
        {initials(c.displayName)}
      </span>
      <div class="ct-main">
        <div class="ct-head">
          <strong dir="auto">{c.displayName}</strong>
          <span class="eng-tag">{languageName(c.language)}</span>
          {c.casparName && (
            <span class="ct-onscreen tip" data-tip="Name on screen: the lower third when the guest is on air." dir="auto">
              {c.casparName}
            </span>
          )}
        </div>
        {reach.length > 0 && (
          <div class="ct-reach">
            {reach.map(({ key, value }) => {
              const href = channelLink(key, value);
              const inner = (
                <>
                  <Icon name={CHANNEL_ICONS[key]} />
                  <span class="ct-chan-label">{CHANNEL_LABELS[key]}</span>
                  <span dir="ltr">{value}</span>
                </>
              );
              return href ? (
                <a key={key} class="ct-chan link" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
                  {inner}
                </a>
              ) : (
                <span key={key} class="ct-chan">
                  {inner}
                </span>
              );
            })}
          </div>
        )}
        {c.notes && (
          <div class="ct-notes" dir="auto">
            {c.notes}
          </div>
        )}
      </div>
      {canEdit && (
        <div class="ct-actions">
          <button class="chip" aria-label={`Edit ${c.displayName}`} title="Edit" onClick={onEdit}>
            <Icon name="edit" />
          </button>
          <button class="chip" aria-label={`Remove ${c.displayName}`} title="Remove" onClick={onRemove}>
            <Icon name="trash" />
          </button>
        </div>
      )}
    </article>
  );
}

export function Contacts({ user, nav }: { user: User; nav: ComponentChildren }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = user.role !== 'engineer';

  const load = (query = q) =>
    listContacts(query)
      .then((r) => setRows(r.contacts))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));

  useEffect(() => {
    const timer = setTimeout(() => void load(q), 200);
    return () => clearTimeout(timer);
  }, [q]);

  const run = (p: Promise<unknown>) => {
    setSaving(true);
    setError(null);
    return p
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  const list = rows ?? [];

  return (
    <div class="screen page contacts">
      {nav}
      <header class="adm-top">
        <div class="adm-top-title">
          <h1>Contacts</h1>
          {rows !== null && <span class="ct-count">{list.length}</span>}
        </div>
        <div class="adm-actions">
          <label class="ct-search">
            <Icon name="search" />
            <input type="search" placeholder="Name, number, handle" aria-label="Search the contact book" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          </label>
          {canEdit && (
            <button
              class="btn"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                setEditing(null);
              }}
            >
              <Icon name="plus" />
              Add contact
            </button>
          )}
        </div>
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {adding && (
        <ContactForm
          title="New contact"
          initial={empty()}
          saving={saving}
          onCancel={() => setAdding(false)}
          onSave={(c) =>
            void run(createContact(c)).then(() => {
              setAdding(false);
            })
          }
        />
      )}

      {rows !== null && list.length === 0 && !adding && <div class="eng-empty">{q ? 'No contact matches' : 'The contact book is empty'}</div>}

      <div class="ct-list">
        {list.map((c) =>
          editing === c.id ? (
            <ContactForm
              key={c.id}
              title={c.displayName}
              initial={{ ...c }}
              saving={saving}
              onCancel={() => setEditing(null)}
              onSave={(input) =>
                void run(updateContact(c.id, input)).then(() => {
                  setEditing(null);
                })
              }
            />
          ) : (
            <ContactRow
              key={c.id}
              c={c}
              canEdit={canEdit}
              onEdit={() => {
                setEditing(c.id);
                setAdding(false);
              }}
              onRemove={() => {
                if (confirm(`Remove ${c.displayName} from the contact book?`)) void run(deleteContact(c.id));
              }}
            />
          ),
        )}
      </div>
    </div>
  );
}
