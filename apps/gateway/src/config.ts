// Environment configuration, validated once at start-up.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { hostname } from 'node:os';
import { z } from 'zod';

const schema = z.object({
  /** The waar Connect API; on the VM it listens on localhost only. */
  API_URL: z.url().default('http://127.0.0.1:8788'),
  /** Shared with the API (GATEWAY_TOKEN in apps/api/.env); sent as the x-wc-gateway header. */
  GATEWAY_TOKEN: z.string().min(16, 'at least 16 characters'),
  /** Shown to the admin as where the gateway runs. */
  GATEWAY_NAME: z.string().trim().min(1).default(() => hostname()),
  /** Path to libndi.so.6 / Processing.NDI.Lib.x64.dll; found automatically when empty. */
  NDI_LIB: z.string().trim().optional(),
  /** Comma-separated IPs of NDI senders on other subnets, where mDNS discovery does not reach. */
  NDI_EXTRA_IPS: z.string().trim().default(''),
  /**
   * Picture height sent when a PCR sets none of its own. The program is scaled down before the encode,
   * which is the gateway's main CPU cost (540p is about a quarter of 1080p). 0 = the source's size.
   */
  RETURN_HEIGHT: z.coerce
    .number()
    .int()
    .refine((n) => [0, 360, 540, 720, 1080].includes(n), '0 (source size), 360, 540, 720 or 1080')
    .default(540),
  /** Bitrate cap of the program picture when a PCR sets none of its own. */
  RETURN_MAX_KBPS: z.coerce.number().int().min(500).max(8000).default(1500),
  /** A 50 fps program is sent at 25: every second frame. */
  RETURN_MAX_FPS: z.coerce.number().int().min(10).max(60).default(30),
  /** 1-based NDI audio channels that carry the mix-minus; averaged into one channel for the guests. */
  RETURN_AUDIO_CHANNELS: z
    .string()
    .trim()
    .regex(/^\d+(,\d+)*$/, 'comma-separated channel numbers, e.g. 1,2')
    .default('1,2'),
  /** How often the gateway asks the API which PCRs want a return feed. */
  POLL_SECONDS: z.coerce.number().min(3).max(120).default(15),
  /** How often the gateway reports its sources and feeds to the API. */
  REPORT_SECONDS: z.coerce.number().min(2).max(60).default(5),
});

export type Config = Readonly<z.infer<typeof schema>> & {
  /** RETURN_AUDIO_CHANNELS as numbers, still 1-based. */
  readonly audioChannels: readonly number[];
  readonly extraIps: readonly string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Bad environment: ${issues}. Copy .env.example to .env and fill it in.`);
  }
  const data = parsed.data;
  return {
    ...data,
    audioChannels: data.RETURN_AUDIO_CHANNELS.split(',').map(Number).filter((n) => n >= 1),
    extraIps: data.NDI_EXTRA_IPS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
