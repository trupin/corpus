// The projection's maintenance surface: `POST /api/db/rebuild` and
// `GET /api/db/doctor` (SPEC.md §2.2, §11).
//
// Both go over HTTP rather than running inside the CLI for the reason every
// other verb does: the server is the sole writer, and it is the process holding
// the open `cache.db` handle. A CLI that rebuilt the file itself would leave a
// running server reading a replaced inode — which is exactly the hazard this
// module has to answer for *in-process* too, and the reason `rebuild` runs
// inside `ProjectionDb.reopenAround`.

import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  contractRoutes,
  type DoctorReport as WireDoctorReport,
  type QueryKey,
  type RebuildResult as WireRebuildResult,
} from "@corpus/contract";
import { actorOf } from "../docs/actor.js";
import { AGENTS_KEY, DOCS_KEY, JOBS_KEY, QUEUE_KEY, TREE_KEY } from "../events/index.js";
import type { Logger } from "../logger.js";
import type { QueueService } from "../queue/index.js";
import type { IndexMaintenance } from "../semantic/maintenance.js";
import type { ProjectionConfig, ProjectionDb } from "./db.js";
import { doctor, type DoctorReport } from "./doctor.js";
import { createProjectionQueueMirror } from "./queue-mirror.js";
import { rebuild, type RebuildReport } from "./rebuild.js";

/**
 * A rebuild re-derives every table at once, so it announces the whole coarse
 * half of the key vocabulary in **one** frame (SPEC.md §2.2 rule 3). Per-row
 * keys are deliberately absent: after a rebuild every row is new, and naming
 * them individually would be a frame per document rather than a signal.
 *
 * **Unconditional, including `["tree"]`, and that is a decision rather than an
 * oversight (SERVER-020).** SERVER-018 and SERVER-020 made every *mutation*
 * frame lawful — it carries `["tree"]` exactly when `GET /api/tree`'s response
 * changed, measured across the write — and this route is deliberately outside
 * that rule, because it is not reporting a change the server made. It is a
 * resynchronization instruction: the operator's reset button for a cache, or a
 * client, nobody trusts any more.
 *
 * Folding it into the measured scheme would mean comparing the tree derived
 * from the rows being discarded against the tree derived from the rows
 * replacing them, and staying silent when they match. That comparison is blind
 * to the case the route exists for — a rebuild is usually run because the
 * *board* looks wrong, which includes a client that missed a frame while the
 * projection was right all along, and there the two signatures match by
 * construction. Over-invalidating a rare, manual, whole-cache operation costs
 * one refetch of a small structure; under-invalidating it costs the point of
 * the command. `projection/routes.test.ts` pins the decision.
 *
 * `["agents"]` joined the list for exactly that reason (SERVER-115): §7's
 * roster is derived from `threads`, `documents`, `events` and `jobs` — every
 * table a rebuild replaces — so it is as much a client of this reset as the
 * board is, and it is the *only* key in the coarse half whose route was left
 * unnamed. It is here unconditionally, on the same ground as `["tree"]`: the
 * measured scheme that governs mutations (`rosterSignature`) compares a roster
 * derived from discarded rows against one derived from their replacements, and
 * the case a rebuild is run for is the one where those match.
 */
export const REBUILD_QUERY_KEYS: readonly QueryKey[] = [
  DOCS_KEY,
  TREE_KEY,
  QUEUE_KEY,
  JOBS_KEY,
  AGENTS_KEY,
];

export interface DbRoutesDeps {
  /** Where the workspace and its `.corpus` directory are; `ServerConfig` satisfies it. */
  readonly config: ProjectionConfig;
  /**
   * The semantic index's operational service (SERVER-046). `doctor` needs one
   * fact only a live process has — which model this server can embed with —
   * because an index whose every vector was produced by some *other* model
   * reports itself fully covered and is entirely unusable (§9.1, §11). Optional
   * because a server can be built without a semantic half at all, and because
   * `doctor` run standalone has no provider to ask.
   */
  readonly index?: IndexMaintenance | undefined;
  /** The server's own handle — the one every other subsystem captured. */
  readonly projection: ProjectionDb;
  /** Rebound after a rebuild, because the queue's reader owns the `events` table. */
  readonly queue: QueueService;
  readonly logger: Logger;
  readonly invalidate: (keys: readonly QueryKey[]) => void;
}

/** The server's report shape, minus its `readonly` arrays, is the wire's. */
function toRebuildResult(report: RebuildReport): WireRebuildResult {
  const { skipped, ...counts } = report;
  return {
    ...counts,
    skipped: skipped.map((entry) => ({ path: entry.path, reason: entry.reason })),
  };
}

/**
 * `Drift.path` is absent for the one kind that concerns no single file
 * (`count_mismatch`); the contract carries the key always and says so with
 * `null`, so a consumer never has to tell "no path" from "the server forgot".
 * A warning's `path` and `commit` follow the same rule (CONTRACT-025).
 *
 * `warnings` is always present, empty included: this handler always runs the
 * pass, so an empty array is the honest answer "it looked and found nothing" —
 * which the contract makes indistinguishable from the absent key anyway.
 */
function toDoctorReport(report: DoctorReport): WireDoctorReport {
  return {
    ok: report.ok,
    drift: report.drift.map((entry) => ({
      kind: entry.kind,
      path: entry.path ?? null,
      detail: entry.detail,
    })),
    warnings: (report.warnings ?? []).map((entry) => ({
      kind: entry.kind,
      path: entry.path ?? null,
      detail: entry.detail,
      commit: entry.commit ?? null,
    })),
    stats: { ...report.stats },
  };
}

export function mountDbRoutes(app: OpenAPIHono, deps: DbRoutesDeps): void {
  app.openapi(contractRoutes.rebuildDb, (c) => {
    // Recorded, never enforced: a rebuild derives state rather than mutating
    // truth, so there is no file to author and no commit to attribute — but the
    // server log should still say who asked for the longest call in the API.
    const actor = actorOf(c.req.valid("header"));

    // Synchronous end to end, so the window in which this process has no open
    // connection cannot be observed by another request: `rebuild` renames its
    // fresh database over `cache.db`, and `reopenAround` reopens on the far
    // side of the rename. Every subsystem that captured the handle — the
    // document routes, the job service, the watcher — follows,
    // because the handle object never changed.
    const report = deps.projection.reopenAround(() =>
      // The live handle's registry, carried into the throwaway one the rebuild
      // projects with: a rebuild re-derives §12's statuses exactly as the boot
      // scan did, or it would answer this call by making them stale.
      rebuild(deps.config, {
        logger: deps.logger,
        derivedFields: deps.projection.derivedFields,
      }),
    );

    // The queue's own reader has the last word on the table it mirrors, exactly
    // as at boot (`attachProjection`): the rebuild repopulated `events` from
    // `projectQueueDir`, and rebinding replaces that with what `claim-all` and
    // `complete <id>` will actually find in the directories.
    deps.queue.attachMirror(createProjectionQueueMirror(deps.projection));

    deps.logger.info("projection rebuilt over the API", {
      actor,
      documents: report.documents,
      skipped: report.skipped.length,
      durationMs: report.durationMs,
    });
    deps.invalidate(REBUILD_QUERY_KEYS);
    return c.json(toRebuildResult(report), 200);
  });

  // Read-only in the strictest sense: `doctor` opens its own read-only
  // connection and mutates nothing, so a drifted projection is reported and
  // never quietly repaired — the point of the check is that drift is visible.
  //
  // The one live question it asks first — which model this server can embed with
  // — reuses `/api/search`'s own resolution, which is cached, single-flight and
  // cooled down, so a run costs at most one probe per cooldown and usually none
  // at all (the worker resolves at boot). Handled here rather than inside
  // `doctor` so the function stays a pure, synchronous check a pre-commit hook
  // can call with no server in sight.
  app.openapi(contractRoutes.doctorDb, async (c) => {
    const effectiveModel = await deps.index?.effectiveModel();
    return c.json(
      toDoctorReport(doctor(deps.config, effectiveModel === undefined ? {} : { effectiveModel })),
      200,
    );
  });
}
