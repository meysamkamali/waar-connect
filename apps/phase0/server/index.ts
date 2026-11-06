// waar Connect phase 0 — token server and static host for the test pages.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.ts';
import { PinGate } from './pin.ts';
import { isRole, mintToken, NAME_PATTERN, ROOM_PATTERN } from './tokens.ts';

const cfg = loadConfig();
const gate = cfg.pin ? new PinGate(cfg.pin) : null;
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // Nginx on the same machine
app.use(express.json({ limit: '4kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, livekitUrl: cfg.livekitUrl });
});

app.get('/api/config', (_req, res) => {
  res.json({ livekitUrl: cfg.livekitUrl, sourceUrl: cfg.sourceUrl, pinRequired: gate !== null });
});

/** Server clock for the latency photographs; the pages estimate their offset from several samples. */
app.get('/api/time', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ now: Date.now() });
});

app.post('/api/token', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (gate) {
    const verdict = gate.check(req.ip ?? 'unknown', body['pin']);
    if (verdict === 'blocked') {
      res.status(429).json({ error: 'Too many wrong PINs from this address. Try again in ten minutes.' });
      return;
    }
    if (verdict === 'wrong') {
      res.status(401).json({ error: 'Wrong PIN.' });
      return;
    }
  }

  const { role, room, name } = body;
  if (!isRole(role)) {
    res.status(400).json({ error: 'Unknown role.' });
    return;
  }
  if (typeof room !== 'string' || !ROOM_PATTERN.test(room)) {
    res.status(400).json({ error: 'Room must be 1-32 lowercase letters, digits or dashes.' });
    return;
  }
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    res.status(400).json({ error: 'Name must be 1-40 letters, digits, spaces, dots or dashes.' });
    return;
  }

  res.json(await mintToken(cfg, { role, room, name }));
});

// Production: serve the built pages from dist/web. In development Vite serves them and proxies /api here.
const webDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../web');
if (existsSync(path.join(webDir, 'index.html'))) {
  app.use(
    express.static(webDir, {
      extensions: ['html'],
      index: 'index.html',
      setHeaders: (res, filePath) => {
        // Pages must always be fresh; hashed assets never change; logo and favicon rarely do.
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    }),
  );
}

app.use((_req, res) => {
  res.status(404).type('text').send('Not found');
});

app.listen(cfg.port, () => {
  console.log(`waar Connect phase 0 on http://localhost:${cfg.port} -> ${cfg.livekitUrl} (${gate ? 'PIN required' : 'no PIN'})`);
  if (!existsSync(path.join(webDir, 'index.html'))) {
    console.log('No built pages found; run "npm run dev:web" for the Vite dev server or "npm run build".');
  }
});
