// Loopback-only guard. SPEC.md §7's job-log ingest (`POST /api/jobs/:id/log`)
// is called by Claude Code hooks, which have no way to carry the workspace
// token — so that one route trades bearer auth for peer-address proof. This
// module is the primitive; SERVER-009 mounts it. Nothing in SERVER-003 uses it.

import type { MiddlewareHandler } from "hono";
import { errorResponse, forbidden } from "../errors.js";

/**
 * Normalizes the peer address Node reports. Dual-stack sockets surface IPv4
 * peers as IPv4-mapped IPv6 (`::ffff:127.0.0.1`), and IPv6 loopback has several
 * spellings.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined || address === "") return false;

  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const unmapped = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;

  if (unmapped === "::1" || unmapped === "0:0:0:0:0:0:0:1") return true;
  // The whole 127.0.0.0/8 block is loopback.
  return (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unmapped) &&
    unmapped.split(".").every((part) => Number(part) <= 255)
  );
}

/** The `@hono/node-server` binding shape we read the peer address from. */
interface NodeServerBindings {
  incoming?: { socket?: { remoteAddress?: string | undefined } | undefined } | undefined;
}

export function getPeerAddress(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const bindings = env as NodeServerBindings;
  return bindings.incoming?.socket?.remoteAddress;
}

/**
 * Rejects any request whose peer is not on the loopback interface. It reads the
 * kernel-reported socket address and deliberately ignores `X-Forwarded-For`:
 * that header is attacker-controlled, and the whole point of this guard is that
 * it cannot be talked out of its answer.
 */
export const localhostOnly: MiddlewareHandler = async (c, next) => {
  if (!isLoopbackAddress(getPeerAddress(c.env))) {
    // 403, not 401: the credential is not the problem and retrying with one
    // will not help — the caller is on the wrong interface.
    return errorResponse(c, forbidden("this endpoint accepts loopback connections only"));
  }
  return next();
};
