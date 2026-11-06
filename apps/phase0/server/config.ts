// waar Connect phase 0 — server configuration from the environment.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export interface Config {
  port: number;
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** null = no PIN (test phase). */
  pin: string | null;
  sourceUrl: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env['PORT'] ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a TCP port number.');

  const livekitUrl = required(env, 'LIVEKIT_URL');
  if (!/^wss?:\/\//.test(livekitUrl)) throw new Error('LIVEKIT_URL must start with wss:// (or ws:// for local tests).');

  const apiSecret = required(env, 'LIVEKIT_API_SECRET');
  if (apiSecret.length < 32) throw new Error('LIVEKIT_API_SECRET must be at least 32 characters.');

  const pin = env['PHASE0_PIN']?.trim() ?? '';
  if (pin && pin.length < 4) throw new Error('PHASE0_PIN must be at least 4 characters, or empty for no PIN.');

  return {
    port,
    livekitUrl,
    apiKey: required(env, 'LIVEKIT_API_KEY'),
    apiSecret,
    pin: pin || null,
    sourceUrl: env['SOURCE_URL']?.trim() || 'https://github.com/meysamkamali/waar-connect',
  };
}
