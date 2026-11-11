// The copies a phone sends of its picture (simulcast): the full-size one and, beside it, two small
// ones that small pictures and weak viewers take. The bitrate cap is for the full-size copy; the small
// copies keep their own ceilings, but never more than a share of the cap. The phone sets these
// (guest/session.ts) and the engineer's meters read each copy against its ceiling (lib/quality.ts).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

/** By the copy's name on the wire (rid): its own ceiling in bit/s, and its share of the cap at low caps. */
export const SMALL_COPIES: Readonly<Record<string, { own: number; share: number }>> = {
  q: { own: 150_000, share: 0.12 },
  h: { own: 500_000, share: 0.35 },
};

/** The most a small copy may send, in bit/s, when the full-size copy's cap is `capKbps`. */
export function smallCopyCeiling(rid: string, capKbps: number): number | undefined {
  const small = SMALL_COPIES[rid];
  return small ? Math.round(Math.min(small.own, capKbps * 1000 * small.share)) : undefined;
}
