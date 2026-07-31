import { createRoute } from "@hono/zod-openapi";
import { IndexStatusSchema } from "../schemas/index-maintenance.js";
import { jsonContent, UNAUTHORIZED_RESPONSE } from "./responses.js";

/**
 * The semantic index's maintenance pair (SPEC.md §9.1's verbs bullet, §9.2's
 * index bullet) — the two endpoints `corpus index status` and
 * `corpus index rebuild` are thin typed-client calls over.
 *
 * **`index-maintenance.ts`, never `index.ts`**: `./index.ts` is this directory's
 * route barrel, and a sibling module competing for the name would resolve today
 * and become a trap the first time someone renames a file on a case-insensitive
 * filesystem.
 *
 * **Neither route carries an acting party**, and that is a deliberate divergence
 * from `POST /api/db/rebuild` two files over, which does (`./db.ts`). SPEC.md
 * §9.2's index bullet is explicit about why: "Both touch only derived runtime
 * state — no workspace file changes, no git commit, **no acting party**." A
 * projection rebuild replaces `.corpus/cache.db`, and the actor header is there
 * because §14's mutation vocabulary follows every write path; these two touch
 * only the semantic index's own derived rows, produce no commit, and so have no
 * author to attribute. Declaring `ActorHeaderSchema` here would publish an input
 * that nothing reads.
 *
 * With no header, no body and no query, neither operation validates request
 * input at all — which is why neither declares `400`, matching the rest of the
 * contract's input-free reads.
 *
 * **What is deliberately *not* here.** A doctor finding for a stuck index — a
 * `warnings` entry when `failed > 0` — needs no contract change: `DoctorWarning`'s
 * `kind` is an **open** string by construction (`../schemas/db.ts`), precisely so
 * a new report-only pass is a server change rather than a contract release. No
 * kind literal is added here, and none should be.
 */

export const getIndexStatus = createRoute({
  method: "get",
  path: "/api/index/status",
  tags: ["index"],
  summary: "Semantic-index health",
  description:
    "Reports the semantic index's coverage — indexed, pending and failed chunk counts — the " +
    "recorded provider/model identity, whether a full rebuild is in progress, and the single " +
    "`state` those facts derive to (SPEC.md §9.1). It is the surface that makes asynchronous " +
    "indexing honest rather than hidden: indexing never blocks a save, so a backlog is normal, " +
    "and this is where a person sees it draining. A backlog is **staleness, not drift** — " +
    "`corpus db doctor` stays clean while indexing is in flight (SPEC.md §14), and the two checks " +
    "answer different questions on purpose. `state` is the same value, from the same schema, that " +
    "`GET /api/search` reports as `semanticIndex`. Read-only; no acting party.",
  responses: {
    200: jsonContent(
      IndexStatusSchema,
      "The index's current health. A workspace with no semantic index answers `disabled` with a " +
        "null identity and zero counts — an honest answer, never an error.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const rebuildIndex = createRoute({
  method: "post",
  path: "/api/index/rebuild",
  tags: ["index"],
  summary: "Discard and asynchronously rebuild the semantic index",
  description:
    "Discards the semantic index and re-queues every chunk, re-picking the current default " +
    "provider and model as it goes — the narrow counterpart of `POST /api/db/rebuild`, which " +
    "reconstructs the whole projection and likewise queues semantic re-indexing (SPEC.md §9.1). " +
    "**Takes no request body at all**, and carries no acting party: it touches only derived " +
    "runtime state, so there is no workspace file change and no git commit to attribute " +
    "(SPEC.md §9.2). " +
    "**Returns immediately, before the work is done** — hence `202`, and hence a response that " +
    "reports only what is already true: the `IndexStatus` snapshot taken the moment everything " +
    "was queued, which is a caller's acknowledgement (`identity` re-picked, `rebuilding` true, " +
    "`pending` at the full corpus) and never a claim of completion. Progress is observed by " +
    "polling `GET /api/index/status`; meanwhile ranked search stays fully available on its " +
    "lexical half and says `indexing` while it waits. This is also how a `failed` chunk gets " +
    "another attempt: failures do not drain on their own.",
  responses: {
    202: jsonContent(
      IndexStatusSchema,
      "Accepted and queued, not completed. The snapshot is true at the moment of the call: " +
        "`rebuilding` is true, `pending` counts what was just queued, and `state` is `indexing`.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});
