// `GET /attachments/<thread-id>/<turn-ts>/<filename>` — the read half of
// SPEC.md §6, and the only route in Corpus that turns a client-supplied string
// into a filesystem path.
//
// **This handler mutates nothing.** No projection write, no commit, no
// invalidation, no bookkeeping file. Serving twenty attachments leaves the
// workspace byte-identical.
//
// # The defence, in the order it runs
//
// Each layer is independently sufficient for the attacks below it; they are
// stacked because "sufficient" is a claim about the code as written, and this
// path outlives any one reading of it.
//
// 1. **Auth first.** `app.ts` guards `/attachments` and `/attachments/*` with
//    the bearer middleware, so the handler never sees an unauthenticated
//    request and a 401 reveals nothing about what exists.
// 2. **Split before decoding.** The raw request path is split on `/` and only
//    then is each segment decoded, **exactly once**. `%2f` therefore becomes a
//    literal `/` *inside* a segment (rejected in step 4) rather than a new
//    boundary, and `%252e%252e%252f` decodes to the harmless literal
//    `%2e%2e%2f` — a second decode pass is what would open that hole.
// 3. **Exactly three segments.** The layout is `<thread>/<ts>/<name>`; anything
//    else is not an attachment path, so a deep path never reaches resolution.
// 4. **Segment validation, before any filesystem call.** A segment that is
//    empty, `.`, `..`, or that contains `/`, `\`, NUL or a control byte is
//    refused. This runs before resolution, so a traversal that would have
//    landed back inside the root is still a traversal (and still refused).
// 5. **Containment.** The resolved path must sit under the attachments root.
// 6. **No symlink anywhere in the chain.** Every component is `lstat`ed —
//    intermediates must be real directories, the leaf a real file — and the
//    leaf is finally opened `O_NOFOLLOW`, which closes the window between the
//    check and the open. A symlink planted inside the root does not escape it.
// 7. **Exact case.** Each component must appear in its parent's directory
//    listing byte-for-byte. macOS `realpath` does *not* canonicalise case, so
//    without this a case-insensitive filesystem would answer `SHOT.PNG` with
//    `shot.png` and CI's Linux would 404 — one behaviour on the developer's
//    machine and another in CI is not a decided behaviour.
//
// **Every failure is the same 404**, with the same body and the same headers,
// whether the path was malformed, escaped the root, named a missing file or
// named a thread that never existed. Distinguishable failures are a filesystem
// map.

import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { hasControlCharacter, stripControlCharacters, toPrintableAscii } from "./chars.js";
import { contentTypeOf, isInlineDisposition } from "./mime.js";

/** URL prefix the route owns. Mirrors the contract's `/attachments/{path}`. */
export const ATTACHMENTS_PATH_PREFIX = "/attachments";

/** `<thread-id>/<turn-ts>/<filename>` — nothing shallower, nothing deeper. */
export const ATTACHMENT_PATH_SEGMENTS = 3;

/**
 * The one body every refusal produces. Deliberately says nothing about which
 * check failed, and names no path: the contract's `not_found` shape, and no
 * more information than "no".
 */
export const ATTACHMENT_NOT_FOUND_BODY = {
  code: "not_found",
  message: "no such attachment",
} as const;

export const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

/** Set on every response, hit or miss — a sniffed content type is a content type an attacker chose. */
const NO_SNIFF = { "X-Content-Type-Options": "nosniff" } as const;

/** Valid as one component of an attachment path. Runs before any filesystem call. */
export function isSafeSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false;
  if (segment.includes("/") || segment.includes("\\")) return false;
  return !hasControlCharacter(segment);
}

/**
 * The decoded segments of an attachment request, or `null` for anything that is
 * not a well-formed attachment path. Exported so the rules are testable without
 * a filesystem or a server.
 */
export function parseAttachmentPath(rawPath: string): string[] | null {
  if (!rawPath.startsWith(ATTACHMENTS_PATH_PREFIX)) return null;
  const rest = rawPath.slice(ATTACHMENTS_PATH_PREFIX.length);
  if (rest === "" || rest === "/") return null;
  if (!rest.startsWith("/")) return null;

  const raw = rest.slice(1).split("/");
  if (raw.length !== ATTACHMENT_PATH_SEGMENTS) return null;

  const segments: string[] = [];
  for (const encoded of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      // A malformed escape is not a path; it is certainly not one to guess at.
      return null;
    }
    if (!isSafeSegment(decoded)) return null;
    segments.push(decoded);
  }
  return segments;
}

/**
 * Walk the segments under `root`, refusing a symlink or a case-insensitive
 * match at any level. Returns the absolute path of the leaf, or `null`.
 */
function resolveExisting(root: string, segments: readonly string[]): string | null {
  const absolute = resolve(root, ...segments);
  // Redundant given {@link isSafeSegment}, and kept anyway: containment is the
  // property that matters, and asserting it costs one string comparison.
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) return null;

  let current = resolve(root);
  for (const [index, segment] of segments.entries()) {
    const next = join(current, segment);
    let stats;
    try {
      stats = lstatSync(next);
    } catch {
      return null;
    }
    const isLeaf = index === segments.length - 1;
    // `lstat` does not follow, so a symlink reports as neither a file nor a
    // directory here — which is the rejection, not an oversight.
    if (isLeaf ? !stats.isFile() : !stats.isDirectory()) return null;
    try {
      if (!readdirSync(current).includes(segment)) return null;
    } catch {
      return null;
    }
    current = next;
  }
  return current;
}

function notFoundResponse(c: Context): Response {
  return c.json(ATTACHMENT_NOT_FOUND_BODY, 404, { ...NO_SNIFF });
}

/**
 * `Content-Disposition` for a stored name. The sanitizer only ever produces
 * letters, digits, `.`, `-` and `_`, so a quote or a newline cannot appear — the
 * escape and the ASCII fallback are here because a header that depends on a
 * *different* module's invariant for its safety is one refactor from being a
 * header-injection bug.
 */
export function contentDisposition(name: string): string {
  const kind = isInlineDisposition(name) ? "inline" : "attachment";
  const quoted = [...stripControlCharacters(name)]
    .map((character) => (character === '"' || character === "\\" ? "_" : character))
    .join("");
  const ascii = toPrintableAscii(quoted, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export interface AttachmentServeOptions {
  /** Absolute path of `.corpus/attachments`. */
  readonly attachmentsRoot: string;
}

/** The handler, as a plain function so it can be exercised without a server. */
export function createAttachmentHandler(options: AttachmentServeOptions): (c: Context) => Response {
  return (c) => {
    const segments = parseAttachmentPath(c.req.path);
    if (segments === null) return notFoundResponse(c);

    const absolute = resolveExisting(options.attachmentsRoot, segments);
    if (absolute === null) return notFoundResponse(c);

    const name = segments[segments.length - 1] ?? "";

    let fd: number;
    try {
      // `O_NOFOLLOW` closes the check-to-open window: a symlink swapped in after
      // the walk fails the open with ELOOP instead of being followed.
      fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return notFoundResponse(c);
    }

    let size: number;
    try {
      const stats = fstatSync(fd);
      if (!stats.isFile()) {
        closeSync(fd);
        return notFoundResponse(c);
      }
      size = stats.size;
    } catch {
      closeSync(fd);
      return notFoundResponse(c);
    }

    // Streamed from the descriptor already validated, rather than re-opened by
    // path: nothing between the check and the bytes can be substituted. The cast
    // is a `@types/node` gap — `Readable.toWeb` is declared as returning the DOM
    // `ReadableStream<any>`, which Hono's body parameter will not accept.
    const stream = Readable.toWeb(
      createReadStream("", { fd, autoClose: true }),
    ) as ReadableStream<Uint8Array>;

    return c.body(stream, 200, {
      "Content-Type": contentTypeOf(name),
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(name),
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      ...NO_SNIFF,
    });
  };
}

/**
 * The request target exactly as the client sent it, when the adapter exposes it
 * (`@hono/node-server` puts Node's `IncomingMessage` on `c.env.incoming`).
 * `undefined` for an adapter that does not — `app.request` in tests, an edge
 * runtime in principle — where there is no unnormalized form to inspect.
 */
function rawRequestTarget(c: Context): string | undefined {
  const env: unknown = c.env;
  if (typeof env !== "object" || env === null) return undefined;
  const incoming: unknown = (env as { incoming?: unknown }).incoming;
  if (typeof incoming !== "object" || incoming === null) return undefined;
  const url: unknown = (incoming as { url?: unknown }).url;
  return typeof url === "string" ? url : undefined;
}

/**
 * The spellings the URL Standard treats as a dot segment, lowercased. The
 * parser's "single-dot path segment" is `.` or `%2e`, and its "double-dot path
 * segment" is `..`, `.%2e`, `%2e.` or `%2e%2e` — each ASCII case-insensitive.
 * All six are removed (or pop a segment) *before* Corpus code runs, so all six
 * have to be refused here; comparing against the two literal spellings alone
 * left `%2e%2e` reaching a real attachment through a sideways traversal
 * (SERVER-022 finding 1).
 */
const DOT_SEGMENT_SPELLINGS: ReadonlySet<string> = new Set([
  ".",
  "%2e",
  "..",
  ".%2e",
  "%2e.",
  "%2e%2e",
]);

/**
 * True when the *unnormalized* target names an attachment path containing a
 * dot segment in any of its spellings, an empty segment, or a backslash.
 *
 * This exists because the traversal never reaches {@link parseAttachmentPath}.
 * Every `Request` is built by the WHATWG URL parser, which resolves `.` and
 * `..` and rewrites `\` to `/` **before** any Corpus code runs: by the time
 * Hono routes, `GET /attachments/../../../etc/hosts` has become `GET
 * /etc/hosts` and the attachment route is not even consulted. That is correct
 * per the URL Standard and leaks nothing — the answer is byte-identical to any
 * other unknown path — but it has two consequences worth refusing outright.
 * First, `/attachments/a/b/../../<thread>/<ts>/x.png` would resolve back to a
 * *real* attachment and be served, which is the "a harmless traversal is still
 * a traversal" rule this module states and could not otherwise enforce.
 * Second, the answer to a raw probe would differ from the answer to its encoded
 * twin, and one uniform refusal is the whole point of the 404 above.
 *
 * No real client is affected: browsers, `fetch` and `curl` all normalise before
 * sending, so a dot segment only ever arrives from `curl --path-as-is` or a
 * hand-built socket.
 */
export function isUnnormalizedAttachmentTarget(target: string): boolean {
  const path = target.split("?")[0] ?? "";
  if (path !== ATTACHMENTS_PATH_PREFIX && !path.startsWith(`${ATTACHMENTS_PATH_PREFIX}/`)) {
    return false;
  }
  if (path.includes("\\")) return true;
  return path
    .slice(ATTACHMENTS_PATH_PREFIX.length)
    .split("/")
    .slice(1)
    .some((segment) => segment === "" || DOT_SEGMENT_SPELLINGS.has(segment.toLowerCase()));
}

/**
 * Refuses an unnormalized attachment target with the route's own 404, before
 * routing gets to reinterpret it as some other path. Mounted globally because
 * the *normalized* path no longer matches `/attachments/*`, which is exactly
 * the problem.
 */
export function createRawAttachmentPathGuard(): MiddlewareHandler {
  return async (c, next) => {
    const target = rawRequestTarget(c);
    if (target !== undefined && isUnnormalizedAttachmentTarget(target)) {
      return notFoundResponse(c);
    }
    await next();
  };
}

/**
 * Mounts the read route.
 *
 * A wildcard rather than `app.openapi(contractRoutes.getAttachment, …)`: the
 * contract's `path` parameter is slash-bearing and its own description says
 * "servers mount it as a wildcard rather than a single segment", which
 * `@hono/zod-openapi`'s `:path` cannot express. Mounting the bare
 * `/attachments` too is what makes a too-short path answer with the route's own
 * uniform 404 instead of the app's generic one — one shape for every miss.
 */
export function mountAttachmentRoutes(app: OpenAPIHono, options: AttachmentServeOptions): void {
  const handler = createAttachmentHandler(options);
  app.get(ATTACHMENTS_PATH_PREFIX, handler);
  app.get(`${ATTACHMENTS_PATH_PREFIX}/*`, handler);
}
