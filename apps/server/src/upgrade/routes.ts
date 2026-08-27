import type { OpenAPIHono } from "@hono/zod-openapi";
import { relative, sep } from "node:path";
import {
  contractRoutes,
  evaluateRelease,
  lookupLatestRelease,
  releaseSource,
} from "@corpus/contract";
import type { UpgradeCheck } from "@corpus/contract";
import { conflict, internalError } from "../errors.js";
import type { SpawnFn } from "./trigger.js";
import { startDetachedUpgrade } from "./trigger.js";

/**
 * SPEC.md §2.4's two routes — the only place in the server that talks to GitHub,
 * and the only place that starts a process it expects to outlive it.
 *
 * **The check reaches GitHub directly; the trigger spawns the CLI.** They are
 * asymmetric on purpose. The judgment the check publishes — is there a newer
 * release, and does it publish the checksum the upgrade verifies — is the same
 * judgment the upgrade will act on, so it is imported from `@corpus/contract`
 * rather than written again (CONTRACT-090); a server that offered an upgrade the
 * CLI then refused would be the exact failure `UpgradeCheckSchema` tells clients
 * to avoid. The *upgrade* is not importable in that way and never will be: it
 * ends by restarting this process.
 *
 * **Nothing is cached between the two, or between calls.** §2.4 opens with
 * "never checks for, downloads, or installs anything in the background, and
 * never phones home", and the way to keep that promise is to hold no state that
 * could be refreshed — there is no cache to invalidate here because there is no
 * cache.
 */

/**
 * Ten seconds. The caller is a person who pressed a button and is watching a
 * spinner, and an unreachable GitHub is a described answer here rather than a
 * failure — so the cost of giving up early is one honest "could not look", and
 * the cost of waiting is a UI that appears wedged.
 */
export const CHECK_TIMEOUT_MS = 10_000;

export interface UpgradeRouteOptions {
  /** The running server's version — `installed` on every answer, reachable or not. */
  readonly version: string;
  readonly workspaceRoot: string;
  /** Absolute path of `.corpus/`; the log and the guard's pidfile live in it. */
  readonly corpusDir: string;
  /** Where the CLI is looked for — `defaultPackageRoot()` in a running server. */
  readonly packageRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly spawn?: SpawnFn;
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

/** One request, no cache, and "I could not look" as a `200` rather than a `5xx`. */
export async function checkForUpgrade(options: UpgradeRouteOptions): Promise<UpgradeCheck> {
  const source = releaseSource(options.env);
  const lookup = await lookupLatestRelease({
    fetch: options.fetch ?? globalThis.fetch,
    api: source.api,
    repo: source.repo,
    version: options.version,
    timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS,
  });
  return evaluateRelease(options.version, lookup).check;
}

/**
 * Workspace-relative, with forward slashes, because that is the spelling every
 * path on this surface uses and the client rendering it is a browser.
 */
export function workspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return relative(workspaceRoot, absolutePath).split(sep).join("/");
}

export function mountUpgradeRoutes(app: OpenAPIHono, options: UpgradeRouteOptions): void {
  app.openapi(contractRoutes.checkUpgrade, async (c) =>
    c.json(await checkForUpgrade(options), 200),
  );

  app.openapi(contractRoutes.startUpgrade, (c) => {
    const result = startDetachedUpgrade({
      workspaceRoot: options.workspaceRoot,
      corpusDir: options.corpusDir,
      packageRoot: options.packageRoot,
      env: options.env,
      ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      ...(options.isAlive === undefined ? {} : { isAlive: options.isAlive }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    if (result.kind === "in-flight") {
      // The `409` the route declares, and the only refusal it has. Two installs
      // racing over the same npm prefix is how a working installation becomes a
      // broken one, so the message says what is happening and where to watch it
      // rather than inviting a retry.
      throw conflict(
        `an upgrade started at ${result.startedAt} is still running; ` +
          `watch ${workspaceRelative(options.workspaceRoot, options.corpusDir)}/upgrade.log, ` +
          "and try again if it has finished",
      );
    }
    if (result.kind === "no-cli") {
      throw internalError(
        "the corpus CLI is missing from this installation, so no upgrade can be started " +
          `(looked in ${result.searched.join(", ")})`,
      );
    }
    if (result.kind === "failed") throw internalError(result.detail);

    return c.json(
      {
        started: true as const,
        logPath: workspaceRelative(options.workspaceRoot, result.reportPath),
      },
      202,
    );
  });
}
