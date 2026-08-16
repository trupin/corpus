// SERVER-110: the queue's answer to "where did this work come from".
//
// The one place §9.2's `job` becomes §7's `origin`. It is deliberately thin —
// a read and a walk — because the interesting part is `core/provenance.ts`'s
// `resolveOrigin`, which SERVER-111 will reuse to decide an event's *lane*. The
// two must agree: a document filed into one scope while its follow-up work
// queues on another is a resident that owns the artifact and never hears about
// it.

import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { isStampable, resolveOrigin } from "../core/provenance.js";
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
export function createJobLookup(store: QueueStore): JobLookup {
  return {
    originFor(job: string): JobOrigin {
      for (const status of QUEUE_EVENT_STATUSES) {
        const found = store.readEventSync(status, job);
        if (found === undefined) continue;
        // A file that exists but does not parse is not a job anyone can serve.
        // Treated as unknown rather than thrown: a corrupt event is §14's
        // problem, and a write should not fail because of one.
        if (!found.ok) return { ok: false, reason: "unknown" };
        // Settled work cannot acquire a scope: `processed`, `failed` and
        // `abandoned` name work that is over, so a write claiming to serve one
        // is a stale id being reused or a loop that never settled its own
        // event. Reported with the status, because "which one" is the whole
        // difference between those two mistakes.
        if (!isStampable(status)) return { ok: false, reason: "settled", status };
        return { ok: true, origin: resolveOrigin(found.event.payload) };
      }
      return { ok: false, reason: "unknown" };
    },
  };
}
