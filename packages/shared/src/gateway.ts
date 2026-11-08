// What the gateway (NDI in and out) reports to the API, and what the API shows the admin.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

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
  /** What goes out: codec on the wire and the bitrate cap. */
  publish: { codec: string; maxKbps: number; maxFps: number } | null;
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
  returns: ReturnFeedStatus[];
}

/** The last report with the time the API received it. */
export interface GatewayStatus extends GatewayReport {
  seenAt: number;
}

/** A gateway report older than this counts as a gateway that is gone. */
export const GATEWAY_STALE_MS = 20_000;
