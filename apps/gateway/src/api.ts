// The gateway's side of the API: which PCRs want a return feed, and the status report back.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { GatewayReport } from '@waar-connect/shared';
import type { ReturnTarget } from './return-feed.ts';

export const GATEWAY_HEADER = 'x-wc-gateway';

export class ApiClient {
  readonly #base: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.#base = baseUrl.replace(/\/+$/, '');
    this.#token = token;
  }

  /** Which PCRs want a return feed, and the admin's list of NDI sender addresses on other networks. */
  async poll(): Promise<{ targets: ReturnTarget[]; extraIps: string[] }> {
    const data = await this.#call<{ returns: ReturnTarget[]; extraIps?: string[] }>('GET', '/api/v1/gateway/returns');
    return { targets: data.returns, extraIps: data.extraIps ?? [] };
  }

  async report(report: GatewayReport): Promise<void> {
    await this.#call('POST', '/api/v1/gateway/report', report);
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { [GATEWAY_HEADER]: this.#token }, signal: AbortSignal.timeout(10_000) };
    if (body !== undefined) {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${this.#base}${path}`, init);
    const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error ?? ''}`.trim());
    return data;
  }
}
