// Serving the pre-built UI (SPEC.md §2.1: the installed tool bundles the UI and
// the server hands it out statically). Two behaviours matter beyond "send the
// file": the SPA fallback, so a deep link like `/doc/abc` reaches the React
// router instead of a 404, and a legible failure when no build is present —
// a missing UI must never take the API down with it.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Logger } from "./logger.js";

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
 * `GET`/`HEAD` requests outside the reserved prefixes; everything else calls
 * `next()` and ends up in routing, so the API keeps working with no UI present.
 */
export function mountStaticUi(app: StaticUiTarget, options: StaticUiOptions): void {
  const { distDir, logger } = options;
  const available = distDir !== undefined && existsSync(distDir);

  if (distDir !== undefined && !available) {
    logger.error(UI_MISSING_MESSAGE, { distDir });
  }

  const staticHandler = available ? serveStatic({ root: distDir }) : undefined;

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") return next();
    if (isReservedPath(c.req.path)) return next();

    if (staticHandler !== undefined) {
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

    return serveAppShell(c, distDir, logger);
  });
}

/**
 * The SPA fallback: any unmatched non-reserved GET gets `index.html`, always
 * revalidated so a redeploy is picked up without a hard refresh. With no build
 * present it degrades to a 503 naming the fix — plain text, because this path is
 * outside `/api` and its reader is a person who just opened the board URL, not
 * a client expecting the contract's `ApiError`.
 */
function serveAppShell(c: Context, distDir: string | undefined, logger: Logger): Response {
  if (distDir !== undefined) {
    const indexPath = join(distDir, "index.html");
    try {
      const html = readFileSync(indexPath, "utf8");
      return c.newResponse(html, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": REVALIDATE_CACHE_CONTROL,
      });
    } catch (cause) {
      logger.error("UI dist directory has no readable index.html", {
        indexPath,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return c.newResponse(`${UI_MISSING_MESSAGE}\n`, 503, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": REVALIDATE_CACHE_CONTROL,
  });
}
