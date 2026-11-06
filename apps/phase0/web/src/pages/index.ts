import '../style.css';
import { ApiError, getConfig, getPin, getToken, setPin } from '../lib/api.ts';
import { $, mountFooter, params } from '../lib/dom.ts';
import { slug } from '../lib/room.ts';

const form = $<HTMLFormElement>('#form');
const pinInput = $<HTMLInputElement>('#pin');
const roomInput = $<HTMLInputElement>('#room');
const nameInput = $<HTMLInputElement>('#name');
const message = $('#message');
const outLink = $('#outlink');
const outUrl = $('#outurl');

const ROOM_KEY = 'wc.room';
const NAME_KEY = 'wc.name';

try {
  pinInput.value = getPin() ?? '';
  roomInput.value = localStorage.getItem(ROOM_KEY) ?? 'test';
  nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
} catch {
  // storage unavailable; defaults stay
}

let go = 'guest';
for (const button of form.querySelectorAll<HTMLButtonElement>('button[data-go]')) {
  button.addEventListener('click', () => {
    go = button.dataset['go'] ?? 'guest';
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submit();
});

async function submit(): Promise<void> {
  const pin = pinInput.value.trim();
  const room = roomInput.value.trim().toLowerCase();
  const name = nameInput.value.trim();
  message.textContent = '';

  if (go === 'guest' && !name) {
    message.textContent = 'Guests need a name.';
    nameInput.focus();
    return;
  }

  const cfg = await getConfig().catch(() => undefined);
  if (!cfg) {
    message.textContent = 'Server not reachable.';
    return;
  }
  if (cfg.pinRequired) {
    // Check the PIN once here so a wrong PIN fails on this page, not on a phone in the field.
    try {
      await getToken('monitor', room, 'launcher', pin);
    } catch (err) {
      message.textContent = err instanceof ApiError ? err.message : 'Server not reachable.';
      return;
    }
    setPin(pin);
  }
  try {
    localStorage.setItem(ROOM_KEY, room);
    if (name) localStorage.setItem(NAME_KEY, name);
  } catch {
    // fine without
  }

  const next = params().get('next');
  if (next && next.startsWith('/')) {
    location.href = next;
    return;
  }

  const q = new URLSearchParams({ room });
  switch (go) {
    case 'guest': {
      q.set('name', name);
      showOutLink(room, name);
      location.href = `/guest.html?${q}`;
      return;
    }
    case 'studio':
      location.href = `/studio.html?${q}`;
      return;
    case 'monitor':
      location.href = `/monitor.html?${q}`;
      return;
    default:
      location.href = '/clock.html';
  }
}

function showOutLink(room: string, name: string): void {
  const url = `${location.origin}/out.html?room=${encodeURIComponent(room)}&guest=${encodeURIComponent(slug(name))}&buffer=400`;
  outUrl.textContent = url;
  outLink.hidden = false;
}

nameInput.addEventListener('input', () => {
  const name = nameInput.value.trim();
  if (name) showOutLink(roomInput.value.trim().toLowerCase(), name);
  else outLink.hidden = true;
});

$('#copy').addEventListener('click', () => {
  void navigator.clipboard?.writeText(outUrl.textContent ?? '');
});
$('#open').addEventListener('click', () => {
  window.open(outUrl.textContent ?? '', '_blank', 'noopener');
});

void getConfig()
  .then((cfg) => {
    if (!cfg.pinRequired) {
      pinInput.required = false;
      pinInput.closest('label')?.setAttribute('hidden', '');
    }
  })
  .catch(() => undefined);
void mountFooter();
