// Serving the pre-built UI (SPEC.md §2.1: the installed tool bundles the UI and
// the server hands it out statically). Two behaviours matter beyond "send the
// file": the SPA fallback, so a deep link like `/doc/abc` reaches the React
// router instead of a 404, and a legible failure when no build is present —
// a missing UI must never take the API down with it.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Logger } from "./logger.js";
import { HEALTH_PATH } from "./middleware/auth.js";
import {
  TOKEN_SHELL_CACHE_CONTROL,
  injectRuntimeConfig,
  refuseUnsafeTokenDelivery,
  type GuardedContext,
} from "./ui-runtime-config.js";

/**
 * Path prefixes the UI never owns. They must fall through to routing (and from
 * there to the 404 handler) rather than being answered with `index.html` — an
 * API client that receives an HTML shell instead of an error has no way to tell
 * a typo from an outage.
 */
export const RESERVED_PREFIXES = ["/api", "/attachments", "/events"] as const;

export const UI_MISSING_MESSAGE =
  "UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package";

export function isReservedPath(path: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Where this server really publishes its OpenAPI document. Restated here rather
 * than imported from `app.ts` (`OPENAPI_PATH`), which imports this module;
 * `static-ui.test.ts` pins the two together. The health probe needs no copy:
 * its path comes from the contract through `HEALTH_PATH`.
 */
export const API_DOCUMENT_PATH = "/api/openapi.json";

/**
 * How a well-known path is answered instead of with the SPA shell: either
 * `"not-found"` (fall through to routing and the API's `ApiError` 404) or a
 * redirect to the place this server really answers that question.
 */
export type WellKnownAnswer = "not-found" | { readonly redirect: string };

/**
 * Well-known API-ish paths that never receive the SPA shell (SERVER-169).
 *
 * The rule is the one {@link RESERVED_PREFIXES} states, applied to the paths a
 * *tool* asks for by convention rather than the ones this API owns. There is a
 * second reason it matters here: the shell carries the workspace bearer token
 * (SERVER-024), so a tool that probed `/openapi.json` and got the shell was
 * handed a credential in place of an error. These entries are exact paths, not
 * prefixes, because each is a single conventional filename — `/doc/<id>` must
 * still reach the shell even though `/doc` is listed.
 *
 * A redirect is used only where this server has the *same* resource, in the
 * same format, under `/api`. The target carries no token — it is a fixed path —
 * and is a 307 rather than a 308 so a browser does not cache the move forever.
 *
 * - `/openapi.json` → redirect to {@link API_DOCUMENT_PATH}. A 404 would tell a
 *   tool "there is no schema"; the truth is "it lives one level down", and the
 *   target answers an unauthenticated caller with a 401 naming the token it
 *   needs. A typo stays distinguishable from an outage either way.
 * - `/doc` → redirect to {@link API_DOCUMENT_PATH}. Bare `/doc` is
 *   `@hono/zod-openapi`'s documented `app.doc("/doc", …)` location — the
 *   convention of the very framework this server is built on. It is not a router
 *   path: `apps/ui` routes every URL to the board through one catch-all and reads
 *   no path segment, and a `/doc` with no id names no document anyway. Deep
 *   links (`/doc/<id>`) are untouched, because this entry is exact.
 * - `/health` → redirect to {@link HEALTH_PATH}, the same probe, which needs
 *   no token.
 * - `/openapi.yaml`, `/openapi.yml`, `/swagger.json`, `/swagger.yaml` → 404.
 *   This server publishes no YAML form, and the `swagger.*` names conventionally
 *   mean a Swagger 2.0 document; redirecting either to OpenAPI 3.1 JSON would
 *   answer a different question than the one asked.
 * - `/healthz`, `/metrics` → 404. Kubernetes and Prometheus conventions with a
 *   response format this server does not produce.
 *
 * Deliberately not listed: `/docs` and `/swagger-ui` (by convention an HTML page
 * for a person, so the board is not a misleading answer), and anything the React
 * router names (`/`, `/doc/<id>`, `/board/<name>`, …).
 */
export const WELL_KNOWN_PATHS: ReadonlyMap<string, WellKnownAnswer> = new Map<
  string,
  WellKnownAnswer
>([
  ["/openapi.json", { redirect: API_DOCUMENT_PATH }],
  ["/doc", { redirect: API_DOCUMENT_PATH }],
  ["/health", { redirect: HEALTH_PATH }],
  ["/openapi.yaml", "not-found"],
  ["/openapi.yml", "not-found"],
  ["/swagger.json", "not-found"],
  ["/swagger.yaml", "not-found"],
  ["/healthz", "not-found"],
  ["/metrics", "not-found"],
]);

/**
 * Prefixes reserved for the same reason as {@link WELL_KNOWN_PATHS}. RFC 8615's
 * `/.well-known/` space is where clients probe for machine-readable metadata
 * (`security.txt`, OAuth discovery, `change-password`, …); none of it is the
 * board, so every such probe gets a 404, never the shell.
 */
export const WELL_KNOWN_PREFIXES = ["/.well-known"] as const;

/**
 * How `path` is answered instead of with the shell, or `undefined` when the
 * shell is the right answer. Matching is exact and case-sensitive, like routing.
 */
export function wellKnownAnswer(path: string): WellKnownAnswer | undefined {
  const exact = WELL_KNOWN_PATHS.get(path);
  if (exact !== undefined) return exact;
  const prefixed = WELL_KNOWN_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return prefixed ? "not-found" : undefined;
}

/**
 * True for filenames carrying a content hash, which are safe to cache forever
 * because a new build produces a new name. Matches both the `name-HASH.ext`
 * form Vite emits and the `name.HASH.ext` form other bundlers use; eight
 * characters is the shortest hash worth trusting, and it keeps ordinary names
 * like `index.html` or `vendor.min.js` out.
 */
export function isImmutableAsset(filePath: string): boolean {
  return /[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(filePath));
}

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const REVALIDATE_CACHE_CONTROL = "no-cache";

export interface StaticUiOptions {
  /** Absolute path of the built UI, or `undefined` when none was resolvable. */
  readonly distDir: string | undefined;
  readonly logger: Logger;
  /**
   * The workspace bearer token, provisioned into the served shell so an
   * installed build can authenticate with no manual step (SERVER-024; the
   * mechanism and its security rationale live in `ui-runtime-config.ts`).
   * Omitted or empty means "provision nothing": the shell is then the plain
   * bytes on disk and carries no credential to guard.
   */
  readonly token?: string | undefined;
}

/**
 * The slice of a Hono app this module needs. Structural rather than `Hono`
 * itself so an `OpenAPIHono` — whose `Env` generic is invariantly narrower —
 * can be passed without a cast.
 */
export interface StaticUiTarget {
  use(path: string, handler: MiddlewareHandler): unknown;
}

/**
 * Registers UI serving as the last middleware in the chain. It answers only
 * `GET`/`HEAD` requests outside the reserved prefixes, and never hands the shell
 * to a {@link wellKnownAnswer} path; everything else calls
 * `next()` and ends up in routing, so the API keeps working with no UI present.
 */
/**
 * True for the two paths `serveStatic` would answer with the SPA shell itself:
 * the root (which it rewrites directory → `index.html`) and that file by name.
 * Both are routed to `serveAppShell` instead, so every response carrying the
 * shell — and therefore the injected token — goes through one guarded,
 * never-cached path rather than two. Every other path keeps its old behaviour:
 * a real file is served by `serveStatic`, and a miss falls through to the SPA
 * fallback, which is the same guarded shell.
 */
export function isAppShellPath(path: string): boolean {
  return path === "/" || path === "/index.html";
}

export function mountStaticUi(app: StaticUiTarget, options: StaticUiOptions): void {
  const { distDir, logger } = options;
  const token = options.token ?? "";
  const available = distDir !== undefined && existsSync(distDir);

  if (distDir !== undefined && !available) {
    logger.error(UI_MISSING_MESSAGE, { distDir });
  }

  const staticHandler = available ? serveStatic({ root: distDir }) : undefined;

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") return next();
    if (isReservedPath(c.req.path)) return next();

    if (staticHandler !== undefined && !isAppShellPath(c.req.path)) {
      // `serveStatic` returns a Response when it found a file and delegates to
      // the `next` we hand it otherwise; that inner `next` must not advance the
      // real chain, or a miss would skip the SPA fallback below.
      const served = await staticHandler(c, () => Promise.resolve(undefined));
      if (served !== undefined) {
        // Its `onFound` hook runs *after* the Response is built, so a header set
        // there is dropped. The request path is enough to classify the file: the
        // only rewrite `serveStatic` performs is directory → `index.html`, which
        // is not hash-named either way.
        served.headers.set(
          "Cache-Control",
          isImmutableAsset(c.req.path) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
        );
        return served;
      }
    }

    // After `serveStatic`, not beside the reserved-prefix check above: a file
    // the UI build really ships under one of these names is our own bytes and
    // carries no token, so it may still win. What this guard restores is only
    // "this path never reaches the shell".
    const answer = wellKnownAnswer(c.req.path);
    if (answer === "not-found") return next();
    if (answer !== undefined) {
      return c.newResponse(null, 307, {
        Location: answer.redirect,
        "Cache-Control": REVALIDATE_CACHE_CONTROL,
      });
    }

    return serveAppShell(c, distDir, logger, token);
  });
}

/**
 * The SPA fallback: any unmatched non-reserved GET gets `index.html`, always
 * revalidated so a redeploy is picked up without a hard refresh. With no build
 * present it degrades to a 503 naming the fix — plain text, because this path is
 * outside `/api` and its reader is a person who just opened the board URL, not
 * a client expecting the contract's `ApiError`.
 *
 * With a token configured the shell also carries the runtime config block
 * (SERVER-024). The guard runs *after* the read, not before, so a workspace
 * with no UI build still answers the documented 503 rather than a 403 that
 * would send the operator looking for a permissions problem they do not have.
 */
async function serveAppShell(
  c: GuardedContext,
  distDir: string | undefined,
  logger: Logger,
  token: string,
): Promise<Response> {
  const html = distDir === undefined ? undefined : readShell(distDir, logger);

  if (html !== undefined) {
    if (token === "") {
      return c.newResponse(html, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": REVALIDATE_CACHE_CONTROL,
      });
    }

    const refusal = await refuseUnsafeTokenDelivery(c);
    if (refusal !== undefined) return refusal;

    return c.newResponse(injectRuntimeConfig(html, { token }), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": TOKEN_SHELL_CACHE_CONTROL,
      // A cross-origin frame navigation carries no `Origin` and so reaches
      // this response; the same-origin policy stops the framer reading it,
      // and this stops it clickjacking the board.
      "X-Frame-Options": "DENY",
    });
  }

  return c.newResponse(`${UI_MISSING_MESSAGE}\n`, 503, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": REVALIDATE_CACHE_CONTROL,
  });
}

function readShell(distDir: string, logger: Logger): string | undefined {
  const indexPath = join(distDir, "index.html");
  try {
    return readFileSync(indexPath, "utf8");
  } catch (cause) {
    logger.error("UI dist directory has no readable index.html", {
      indexPath,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
    return undefined;
  }
}
