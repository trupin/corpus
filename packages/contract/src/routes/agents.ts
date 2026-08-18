import { createRoute } from "@hono/zod-openapi";
import { AgentRosterSchema } from "../schemas/agents.js";
import { ORCHESTRATOR_LANE } from "../schemas/lane.js";
import { jsonContent, UNAUTHORIZED_RESPONSE } from "./responses.js";

/**
 * `GET /api/agents` — the roster (SPEC.md §7, rider SHARED-043).
 *
 * ## Why a read, and not a stream
 *
 * §7 is explicit: *"Who is running is a read, never a push: the roster and each
 * lane's liveness are read behind the ordinary invalidate keys, like any other
 * projection."* That is not an efficiency note — it is the rule that keeps §2.2's
 * "the server announces invalidation, never data" true of the one surface most
 * tempting to break it for. Liveness looks like something to push, and pushing
 * it would give the UI a second source of truth that no refetch could correct.
 * So this route answers `["agents"]` (`../query-keys.ts`) and nothing about it
 * travels over SSE.
 *
 * ## Why it takes no parameters
 *
 * There is one roster and it is small — one row per lane, and lanes exist only
 * where somebody designated a resident. A filter would let a caller ask for
 * "live lanes only", which is exactly the question the composer's picker must
 * *not* ask: §8's pending-indicator rider turns on being able to show a lane
 * whose listener has lapsed as *waiting to be picked up* rather than hiding it,
 * and a filtered roster would make that state invisible at the one place a
 * person chooses a recipient. Taking no input also keeps it out of the `400`
 * family entirely.
 */
export const getAgentRoster = createRoute({
  method: "get",
  path: "/api/agents",
  tags: ["agents"],
  summary: "The roster of lanes, their residents and their liveness",
  description:
    "Every lane of the queue: which conversation it belongs to, who is resident on it, whether a " +
    "listener is parked on it right now and since when, and a short line about what it is doing " +
    "(SPEC.md §7). The composer reads this to offer a recipient, and the board reads it to show " +
    "who is running.\n\n" +
    `**The \`${ORCHESTRATOR_LANE}\` row is always present** — it exists before anything has been ` +
    "designated and survives the last release — so an empty list is a bug rather than a workspace " +
    "with no agents.\n\n" +
    "**A lane's `resident` is null only on that row.** Every other lane exists because a " +
    "conversation was designated, and since a designation may name no profile (SPEC.md §7) the " +
    "resident of such a lane is an object whose `name` is null — a *general resident*, designated " +
    "and lane-owning like any other. A row with a general resident and a row with a profiled one " +
    "differ in nothing else here: same `lane`, same liveness, same fallback. A client must not " +
    "print a stand-in name for the null; it is null so that it cannot be confused with, or " +
    "collide with, a real profile.\n\n" +
    "**Liveness is observed, never registered.** A lane is live exactly while its listener holds " +
    "a parked scoped `GET /api/queue/idle`: there is no heartbeat to send, no registration to " +
    "keep fresh and no state to reap, so an agent that stops parking stops being present whether " +
    "it exited cleanly, crashed or was killed. A lane that is not live is an ordinary, recoverable " +
    "state — past the grace window its pending events fall back to the orchestrator's unscoped " +
    "claim, so the work is done more slowly and never silently not done.\n\n" +
    "**A read, never a push** (SPEC.md §7). The roster and each lane's liveness arrive over HTTP " +
    'and are refetched when an `invalidate` frame names `["agents"]`; nothing about them travels ' +
    "over SSE, which carries key names and never data. Read-only; no acting party, and no " +
    "parameters — there is one roster, and a filtered one would hide the lapsed lanes the " +
    "recipient picker most needs to show.\n\n" +
    "**Every row here is derived, so the frame that stales it is often named after something " +
    "else.** A lane's `summary` is read off the same `events` and `jobs` rows a queue transition " +
    "or a job-log append writes, and its `origin.title` is the root thread's current title — so " +
    'those writes name `["agents"]` too, alongside `["queue"]`, `["jobs"]` or `["docs"]`. A ' +
    "client that refetches this only on designation and presence changes will show a stale " +
    "roster; `GET /events` lists the full set of emitters.",
  responses: {
    200: jsonContent(AgentRosterSchema, "Every lane, the orchestrator's included."),
    401: UNAUTHORIZED_RESPONSE,
  },
});
