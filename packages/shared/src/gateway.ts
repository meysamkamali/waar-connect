// What the gateway (NDI in and out) reports to the API, and what the API shows the admin.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { OutputFeedStatus } from './ndiout.ts';

export const RETURN_STATES = ['starting', 'waiting-source', 'no-signal', 'receiving', 'publishing', 'error'] as const;
/**
 * starting: feed created, nothing happened yet · waiting-source: the NDI source is not on the network ·
 * no-signal: connected to the source, no video for 2 s (black is sent) · receiving: frames arrive, the
 * room is not connected yet · publishing: frames go out to the room · error: see detail.
 */
export type ReturnState = (typeof RETURN_STATES)[number];

export interface NdiSourceInfo {
  /** Name as NDI shows it, e.g. "MIXER (Program)". */
  name: string;
  /** host:port the gateway would connect to, when known. */
  url: string | null;
  /** The gateway's interface on the sender's subnet, e.g. "ens37"; null when the sender is reached through a router. */
  network: string | null;
  /** The sender is this gateway itself (its own outputs), so not a return source. */
  own: boolean;
}

export interface ReturnFeedStatus {
  pcrId: string;
  pcrName: string;
  /** NDI source name the PCR asked for. */
  source: string;
  state: ReturnState;
  /** Human text: the last error, or what the feed waits for. */
  detail: string | null;
  /** The feed's participant is in the LiveKit room. */
  connected: boolean;
  /** What arrives from NDI right now. */
  video: { width: number; height: number; fps: number } | null;
  audio: { channels: number; sampleRate: number } | null;
  /** What goes out: codec on the wire, the bitrate cap, and the picture size sent (0x0 before the first frame). */
  publish: { codec: string; maxKbps: number; maxFps: number; width: number; height: number } | null;
  /** The multiview strip: how many guests' pictures are in it; null while it is not published. */
  mv?: { tiles: number } | null | undefined;
  /** Since when the feed has been in this state (ms since epoch). */
  since: number;
}

export interface GatewayReport {
  /** Gateway build or package version. */
  version: string;
  /** Machine the gateway runs on. */
  host: string;
  /** Every NDI source the gateway can see on the network right now. */
  sources: NdiSourceInfo[];
  /** Addresses discovery also asks, beyond mDNS: the admin's list plus NDI_EXTRA_IPS on the gateway. */
  extraIps: string[];
  /** What a PCR gets when it names no picture size or bitrate of its own (height null = the source's size). */
  defaults: { height: number | null; kbps: number; fps: number };
  returns: ReturnFeedStatus[];
  /** Every studio slot the gateway sends out as an NDI source. Absent from a gateway older than NDI out. */
  outputs?: OutputFeedStatus[] | undefined;
}

/** The last report with the time the API received it. */
export interface GatewayStatus extends GatewayReport {
  seenAt: number;
}

/** A gateway report older than this counts as a gateway that is gone. */
export const GATEWAY_STALE_MS = 20_000;

/** Picture heights the admin may choose for a return; null on the PCR = the gateway's default. */
export const RETURN_HEIGHTS = [1080, 720, 540, 360] as const;
export type ReturnHeight = (typeof RETURN_HEIGHTS)[number];
/** Bitrate caps offered for a return, kbit/s. */
export const RETURN_KBPS_CHOICES = [200, 300, 500, 800, 1000, 1500, 2000, 3000, 4000, 6000] as const;
