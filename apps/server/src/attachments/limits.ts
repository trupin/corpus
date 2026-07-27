// Upload size caps (SERVER-010).
//
// Two refusals, deliberately at two different moments:
//
// - **Before the body is read**, from the declared `Content-Length` of a
//   multipart request. A 900 MB upload is refused after its headers, without
//   buffering it, so an over-cap request costs the server a header parse.
// - **After parsing**, from the sizes actually received, because
//   `Content-Length` is the client's claim and a chunked request has none at
//   all. This is the authoritative check; the early one is an optimisation.
//
// **Both refusals are `413`**, on every route that takes files — `POST /api/capture`,
// `POST /api/threads/{id}/turns` and `POST /api/threads`, each of which declares
// it (CONTRACT-009). The body stays the `bad_request` `ValidationError` shape
// every other refusal uses, naming the offending file and the cap; only the
// status distinguishes an over-cap upload from a malformed one. SERVER-010
// shipped an interim `400` here because `413` was undeclared at the time and an
// undeclared status is contract drift no generator would catch; that reason is
// gone.

import type { MiddlewareHandler } from "hono";
import { payloadTooLarge } from "../errors.js";

const MEGABYTE = 1024 * 1024;

export const DEFAULT_MAX_FILE_BYTES = 25 * MEGABYTE;
export const DEFAULT_MAX_REQUEST_BYTES = 100 * MEGABYTE;

export interface AttachmentLimits {
  /** Largest single attachment, in bytes. */
  readonly maxFileBytes: number;
  /** Largest total upload for one request, in bytes. */
  readonly maxRequestBytes: number;
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
};

/** Human-readable size, so a refusal reads as a limit rather than as a number. */
export function formatBytes(bytes: number): string {
  if (bytes >= MEGABYTE) {
    const mb = bytes / MEGABYTE;
    return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${String(bytes)} bytes`;
}

/**
 * A cap, in bytes and — when that is not already readable — in units.
 *
 * Both forms, because a file one byte over 25 MB rounds to "25.0 MB" and a
 * refusal reading "is 25.0 MB, over the 25 MB limit" looks like a bug in the
 * comparison rather than a fact about the file.
 */
function describeLimit(limit: number): string {
  const exact = `${String(limit)} bytes`;
  const human = formatBytes(limit);
  return human === exact ? exact : `${exact} (${human})`;
}

export function fileTooLargeMessage(name: string, size: number, limit: number): string {
  return `attachment ${name} is ${String(size)} bytes, over the per-file limit of ${describeLimit(limit)}`;
}

export function requestTooLargeMessage(size: number, limit: number): string {
  return `the upload totals ${String(size)} bytes, over the per-request limit of ${describeLimit(limit)}`;
}

/**
 * Reject an over-cap upload from the sizes actually received. Runs before a
 * single byte is written, so a refused request leaves no directory behind.
 */
export function assertWithinLimits(files: readonly File[], limits: AttachmentLimits): void {
  let total = 0;
  for (const file of files) {
    if (file.size > limits.maxFileBytes) {
      const message = fileTooLargeMessage(file.name, file.size, limits.maxFileBytes);
      throw payloadTooLarge(message, [{ path: "files", message }]);
    }
    total += file.size;
  }
  if (total > limits.maxRequestBytes) {
    const message = requestTooLargeMessage(total, limits.maxRequestBytes);
    throw payloadTooLarge(message, [{ path: "files", message }]);
  }
}

const isMultipart = (contentType: string | undefined): boolean =>
  contentType?.trim().toLowerCase().startsWith("multipart/form-data") === true;

/**
 * Refuses a multipart request whose declared size already exceeds the per-request
 * cap, before any validator has asked for the body.
 *
 * Registered as middleware rather than checked in the handler because the
 * route's Zod validators parse the body first: by the time a handler runs, the
 * whole upload has been buffered, which is exactly what this exists to avoid.
 * A request with no `Content-Length` (chunked) passes through to
 * {@link assertWithinLimits}.
 */
export function createUploadSizeGuard(limits: () => AttachmentLimits): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "POST" && isMultipart(c.req.header("content-type"))) {
      const declared = Number(c.req.header("content-length"));
      const { maxRequestBytes } = limits();
      if (Number.isFinite(declared) && declared > maxRequestBytes) {
        throw payloadTooLarge(requestTooLargeMessage(declared, maxRequestBytes), [
          { path: "files", message: requestTooLargeMessage(declared, maxRequestBytes) },
        ]);
      }
    }
    await next();
  };
}
