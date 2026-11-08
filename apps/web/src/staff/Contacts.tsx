// The guest contact book: how to reach each guest (phone, WhatsApp, Telegram, Skype, email, other).
// Producers and admins edit; engineers read.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, createContact, deleteContact, listContacts, updateContact, type Contact, type ContactInput, type User } from '../api.ts';

export const LANGUAGES: ReadonlyArray<[string, string]> = [
  ['ku', 'Kurdî (Kurmancî)'],
  ['ckb', 'کوردی (سۆرانی)'],
  ['ar', 'العربية'],
  ['en', 'English'],
  ['tr', 'Türkçe'],
];

const FIELDS: ReadonlyArray<[keyof ContactInput, string]> = [
  ['phone', 'Phone'],
  ['whatsapp', 'WhatsApp'],
  ['telegram', 'Telegram'],
  ['skype', 'Skype'],
  ['email', 'Email'],
  ['other', 'Other'],
];

const empty = (): ContactInput => ({ displayName: '', language: 'ku', phone: '', whatsapp: '', telegram: '', skype: '', email: '', other: '', notes: '', casparName: '' });

function ContactForm({ initial, onSave, onCancel, saving }: { initial: ContactInput; onSave: (c: ContactInput) => void; onCancel?: () => void; saving: boolean }) {
  const [c, setC] = useState<ContactInput>(initial);
  const set = (key: keyof ContactInput, value: string) => setC({ ...c, [key]: value });
  return (
    <form
      class="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!c.displayName.trim()) return;
        onSave({ ...c, displayName: c.displayName.trim() });
      }}
    >
      <div class="form-grid">
        <label>
          Name
          <input required value={c.displayName} onInput={(e) => set('displayName', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          Name on screen (lower third)
          <input value={c.casparName ?? ''} onInput={(e) => set('casparName', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          Language
          <select value={c.language ?? 'ku'} onChange={(e) => set('language', (e.currentTarget as HTMLSelectElement).value)}>
            {LANGUAGES.map(([code, label]) => (
              <option value={code} key={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            {label}
            <input value={(c[key] as string | null | undefined) ?? ''} onInput={(e) => set(key, (e.currentTarget as HTMLInputElement).value)} />
          </label>
        ))}
        <label style={{ gridColumn: '1 / -1' }}>
          Notes
          <textarea rows={2} value={c.notes ?? ''} onInput={(e) => set('notes', (e.currentTarget as HTMLTextAreaElement).value)} />
        </label>
      </div>
      <div class="row" style={{ marginTop: '8px' }}>
        <button class="btn" type="submit" disabled={saving}>
          Save
        </button>
        {onCancel && (
          <button class="btn secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function Contacts({ user, nav }: { user: User; nav: ComponentChildren }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Contact[]>([]);
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

  const reach = (c: Contact) =>
    FIELDS.map(([key, label]) => {
      const v = c[key as keyof Contact];
      return v ? `${label} ${v}` : null;
    }).filter((x): x is string => x !== null);

  return (
    <div class="screen page">
      {nav}
      {error && <p class="help bad">{error}</p>}
      <section>
        <div class="row between">
          <h2>Contact book</h2>
          <div class="row">
            <input placeholder="Search name, number, handle…" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
            {canEdit && !adding && (
              <button class="btn" onClick={() => setAdding(true)}>
                Add contact
              </button>
            )}
          </div>
        </div>
        {adding && (
          <ContactForm
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
        {rows.length === 0 && <p class="muted">{q ? 'No contact matches.' : 'The contact book is empty.'}</p>}
        <div class="list" style={{ marginTop: '12px' }}>
          {rows.map((c) =>
            editing === c.id ? (
              <ContactForm
                key={c.id}
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
              <article class="card contact" key={c.id}>
                <div class="row between">
                  <div>
                    <strong>{c.displayName}</strong> <span class="muted small">{LANGUAGES.find(([code]) => code === c.language)?.[1] ?? c.language}</span>
                    {c.casparName && <span class="muted small"> · on screen: {c.casparName}</span>}
                  </div>
                  {canEdit && (
                    <div class="row">
                      <button class="link" onClick={() => setEditing(c.id)}>
                        edit
                      </button>
                      <button
                        class="link bad"
                        onClick={() => {
                          if (confirm(`Remove ${c.displayName} from the contact book?`)) void run(deleteContact(c.id));
                        }}
                      >
                        remove
                      </button>
                    </div>
                  )}
                </div>
                <div class="muted small">{reach(c).length ? reach(c).join(' · ') : 'no contact details yet'}</div>
                {c.notes && <div class="small">{c.notes}</div>}
              </article>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
