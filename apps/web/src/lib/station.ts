// The station lock: which camera, microphone and capture inputs this PC uses.
// The admin sets it once on /app/admin/station; the producer, engineer and return pages only read it,
// so nobody at the desk can switch the hardware by accident. Stored per browser profile.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export interface StationDevice {
  id: string;
  label: string;
}

export interface Station {
  /** Where this PC sits, e.g. "PCR 1 producer desk" or "Studio A return". */
  name: string;
  /** Producer or engineer face camera. */
  camera: StationDevice | null;
  /** Producer or engineer talk microphone. */
  mic: StationDevice | null;
  /** Capture input carrying the program picture for the return feed. */
  returnVideo: StationDevice | null;
  /** Input carrying the mix-minus for the return feed. */
  returnAudio: StationDevice | null;
  lockedAt: string;
}

const KEY = 'wc.station';

export function loadStation(): Station | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Station>;
    return {
      name: typeof s.name === 'string' ? s.name : '',
      camera: s.camera ?? null,
      mic: s.mic ?? null,
      returnVideo: s.returnVideo ?? null,
      returnAudio: s.returnAudio ?? null,
      lockedAt: typeof s.lockedAt === 'string' ? s.lockedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveStation(station: Station): void {
  localStorage.setItem(KEY, JSON.stringify(station));
}

export function clearStation(): void {
  localStorage.removeItem(KEY);
}

/** One line for the staff screen: what this PC will use. */
export function describeStation(station: Station | null): string {
  if (!station) return 'station not set by the admin, browser defaults in use';
  const parts = [station.camera ? `camera ${station.camera.label}` : 'default camera', station.mic ? `mic ${station.mic.label}` : 'default mic'];
  return `${station.name || 'station'}: ${parts.join(' · ')}`;
}

/**
 * The deviceId to use now for a locked device: the stored id when it still exists, else the device
 * with the same label (ids change when site data is cleared), else undefined for the browser default.
 */
export async function resolveDeviceId(kind: MediaDeviceKind, device: StationDevice | null): Promise<string | undefined> {
  if (!device) return undefined;
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
    if (all.some((d) => d.deviceId === device.id)) return device.id;
    return all.find((d) => d.label === device.label)?.deviceId;
  } catch {
    return undefined;
  }
}
