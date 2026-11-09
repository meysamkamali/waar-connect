// Which of this machine's networks an NDI sender sits on, and whether a sender is this gateway itself.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import os from 'node:os';
import type { NdiSourceInfo } from '@waar-connect/shared';

export interface LocalNet {
  iface: string;
  address: string;
  netmask: string;
}

/** This machine's IPv4 networks (loopback left out). */
export function localNets(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LocalNet[] {
  const out: LocalNet[] = [];
  for (const [iface, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ iface, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/** The host part of an NDI url_address: "10.1.1.107:5961" gives "10.1.1.107", "[fe80::1]:5961" gives "fe80::1". */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  const s = url.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) return bracket[1] ?? null;
  const colons = s.split(':').length - 1;
  if (colons > 1) return s; // bare IPv6
  const host = colons === 1 ? s.slice(0, s.indexOf(':')) : s;
  return host || null;
}

function ipv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Name of the local interface on the sender's subnet, or null when the sender is reached through a router. */
export function networkOf(url: string | null, nets: LocalNet[]): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const ip = ipv4(host);
  if (ip === null) return null;
  for (const n of nets) {
    const a = ipv4(n.address);
    const m = ipv4(n.netmask);
    if (a === null || m === null) continue;
    if (((ip ^ a) & m) === 0) return n.iface;
  }
  return null;
}

/** NDI names a sender "MACHINE (source)", MACHINE being the machine's host name in upper case. */
export function isOwnSource(name: string, hostname: string = os.hostname()): boolean {
  const short = hostname.split('.')[0] ?? hostname;
  return short.length > 0 && name.toUpperCase().startsWith(`${short.toUpperCase()} (`);
}

export function describeSource(src: { name: string; url: string | null }, nets: LocalNet[] = localNets(), hostname: string = os.hostname()): NdiSourceInfo {
  return { name: src.name, url: src.url, network: networkOf(src.url, nets), own: isOwnSource(src.name, hostname) };
}
