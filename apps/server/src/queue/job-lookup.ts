// SERVER-110: the queue's answer to "where did this work come from".
//
// The one place §9.2's `job` becomes §7's `origin`. It is deliberately thin —
// a read and a walk — because the interesting part is `core/provenance.ts`'s
// `resolveOrigin`, which SERVER-111 will reuse to decide an event's *lane*. The
// two must agree: a document filed into one scope while its follow-up work
// queues on another is a resident that owns the artifact and never hears about
// it.

import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { isStampable, resolveOrigin, originDocumentOf } from "../core/provenance.js";
import type { ProjectionDb } from "../projection/index.js";
import type { JobLookup, JobOrigin } from "../docs/write.js";
import type { QueueStore } from "./store.js";

/**
 * A lookup over the queue's event files.
 *
 * The search walks every status directory because a `job` names an event, not a
 * location: a resident stamps while **holding** its event (`in-progress`), an
 * orchestrator may stamp one still `pending`, and a `deferred` event is one that
 * will come back to the same owner. Which directory it is in is the queue's
 * business, not the caller's — a caller made to name the status would be a
 * caller made to track it.
 */
export function createJobLookup(store: QueueStore, projection: ProjectionDb): JobLookup {
  return {
    originFor(job: string): JobOrigin {
      for (const status of QUEUE_EVENT_STATUSES) {
        const found = store.readEventSync(status, job);
        if (found === undefined) continue;
        // A file that exists but does not parse is not a job anyone can serve.
        // Treated as unknown rather than thrown: a corrupt event is §11's
        // problem, and a write should not fail because of one.
        if (!found.ok) return { ok: false, reason: "unknown" };
        // Settled work cannot acquire a scope: `processed`, `failed` and
        // `abandoned` name work that is over, so a write claiming to serve one
        // is a stale id being reused or a loop that never settled its own
        // event. Reported with the status, because "which one" is the whole
        // difference between those two mistakes.
        if (!isStampable(status)) return { ok: false, reason: "settled", status };
        const named = resolveOrigin(found.event.payload);
        if (named !== null) return { ok: true, origin: named };
        // The `doc.edited` case, and the only one that needs the corpus: such
        // an event names a **document**, not a thread, so the work belongs to
        // whatever conversation that document already belongs to. Resolving it
        // here is what keeps reflection work — and every artifact it produces —
        // inside the scope it reflects on, rather than starting a new one.
        // `resolveOrigin` cannot do this itself: it is pure by contract, and
        // SERVER-111 calls it on the enqueue path where a read per event would
        // be paid on every message.
        const document = originDocumentOf(found.event.payload);
        if (document === null) return { ok: true, origin: null };
        const row = projection
          .prepare("SELECT origin FROM documents WHERE id = ?")
          .get(document) as { origin: string | null } | undefined;
        return { ok: true, origin: row?.origin ?? null };
      }
      return { ok: false, reason: "unknown" };
    },
  };
}
