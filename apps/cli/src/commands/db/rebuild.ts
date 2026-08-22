import { PROJECTION_COUNT_FIELDS, type RebuildResult } from "@corpus/contract";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus db rebuild` — re-derives `.corpus/cache.db` from the workspace's files
 * alone and swaps it in atomically (SPEC.md §11). It is what makes §9.1's
 * "derived tables only" checkable rather than merely asserted.
 *
 * **It does not use the global `--timeout`.** That flag is the *transport*
 * deadline for an ordinary request — ten seconds, "the server did not answer" —
 * and a rebuild of a large corpus is by the contract's own description the
 * longest-running call in the API. Registering a local `--timeout` is impossible
 * anyway (registry validation rejects a flag that shadows a global, at module
 * load), so the call goes through the untimed client with a deadline of its own,
 * exactly as `queue idle`'s park does.
 */

/** Generous by design: it bounds a hung socket, not the work. */
export const REBUILD_TIMEOUT_MS = 10 * 60_000;

export async function runDbRebuild(context: WorkspaceCommandContext): Promise<void> {
  const { client } = context;
  const result = await client.request(() =>
    client.untimedApi.POST("/api/db/rebuild", { signal: AbortSignal.timeout(REBUILD_TIMEOUT_MS) }),
  );

  context.out.emit(result);
  context.out.line(
    `rebuilt the projection in ${String(result.durationMs)}ms — ${counts(result)}${skipped(result)}`,
  );
}

function counts(result: RebuildResult): string {
  return PROJECTION_COUNT_FIELDS.map((field) =>
    plural(result[field], field.replace(/s$/, ""), field),
  ).join(", ");
}

function skipped(result: RebuildResult): string {
  return result.skipped.length === 0
    ? ""
    : ` — skipped ${plural(result.skipped.length, "file")} (${result.skipped
        .map((entry) => entry.path)
        .join(", ")})`;
}

export const rebuildCommand: WorkspaceCommandSpec = {
  name: "rebuild",
  summary: "Rebuild the projection from the workspace's files.",
  description:
    "Re-derives every row of `.corpus/cache.db` from the files alone and replaces the database " +
    "atomically, so an interrupted rebuild leaves the previous one intact (SPEC.md §11). Files " +
    "are the source of truth; the projection is a cache, and this proves it. Prints the per-table " +
    "row counts and how long it took, and names any file that is a document by location but " +
    "produced no row — an empty `skipped` list is the good case. This call ignores the global " +
    "`--timeout`, which is a ten-second transport deadline: a rebuild of a large corpus is the " +
    "longest-running call in the API and is given ten minutes of its own. `rebuild` followed by a " +
    "clean `doctor` is §11's standing invariant.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus db rebuild",
      description: "Re-derive the projection after editing files outside the app.",
    },
    {
      command: "corpus db rebuild --json",
      description:
        'One JSON value: `{"path":"…/.corpus/cache.db","documents":12,…,"durationMs":412,"skipped":[]}`.',
    },
  ],
  handler: (context) => runDbRebuild(context),
};
