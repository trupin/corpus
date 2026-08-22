// `POST /api/threads/{id}/resident` and `DELETE` — giving a conversation a
// resident agent, and letting it go (SPEC.md §7's resident rider, SHARED-043
// signed 2026-08-13, amended 2026-08-15; SERVER-109).
//
// ## What designation is, and what it deliberately is not
//
// It is **thread state**: one frontmatter field on the thread document, written
// by the same pipeline every other mutation goes through, auto-committed with
// the acting party as author and re-projected before the response. It is not a
// session, a registration or a process handle — which is what lets a designation
// survive a restart, and what makes the roster's "designated, and nobody
// listening" row possible at all. Liveness is a *different* question, answered
// by a parked request and nothing else (§7, SERVER-112).
//
// **Single-valued.** A thread has one resident or none, so designating a thread
// that already has one replaces rather than refuses, and nothing has to
// arbitrate between two. Dissolution is the **absence** of a resident and never
// a third state, which is why the release deletes the key instead of writing
// `resident: null`.
//
// **A resident need not have a profile** (§7's SHARED-048 rider, SERVER-121).
// Naming none is the ordinary designation and requires nothing to exist in the
// workspace first; naming a `type: agent-def` is the refinement. The only two
// things that differ between them in this module are the name lookup — which a
// general designation skips entirely, so it can never 404 — and the word the
// commit subject uses. Everything downstream is deliberately identical, because
// a profile says *how* the agent works and nothing about *what it owns*: the
// same frontmatter key, the same event on the same lane, the same projection
// row, the same release, the same resolution releasing it.
//
// **User-only, both halves** (`403` for `x-corpus-author: agent`). A resident
// claims a conversation and every artifact that grows out of it; an agent able
// to designate would be choosing who answers a person's messages, and an agent
// able to release could quietly stop being resident in a conversation a person
// put it in.
//
// ## What this module does not do, on purpose
//
// **It does not compute a scope.** §7: "scope is computed, never stored" —
// membership is derived at enqueue time by walking origin and parent, so a
// thread designated *after* a document was written captures that document
// retroactively, and a thread whose scope already holds artifacts needs nothing
// done to it here. The lane simply starts routing (SERVER-111).
//
// **It does not re-route anything already queued.** A lane is stamped once, at
// enqueue time, and never rewritten: designating does not move work the
// orchestrator is already holding, and releasing strands nothing — a dissolved
// lane is never live, so its pending events fall back to the orchestrator's
// unscoped claim, computed when that claim is made.
//
// **It does not refuse a resolved thread.** §7 says resolving *releases* a
// resident; it does not make a settled conversation undesignatable, and
// CONTRACT-051 enumerates the refusals — agent, unknown thread, unknown name,
// and a thread with a parent. Designating a resolved conversation is therefore
// allowed, and it is not a trap: `POST .../resolve` releases a resident even
// when the status it asks for is the one that already holds, so the state has a
// way out through the verb §7 names.
//
// **It does not end a parked listener itself, and no longer leaves it parked
// either** (SERVER-128). A release used to be discovered up to a rearm window —
// ~8 minutes — after it landed, which made "stop this agent" a request rather
// than an act. It is now immediate, and the mechanism is deliberately *not* a
// call from here into the parking lot: this module enqueues
// `resident.released`, and `QueueService.enqueue` ends every park on the lane
// that event names. One path, so a release that announces itself and a release
// that ends the park cannot come apart — including the two releases this module
// does not perform, resolution's (`threads/status.ts`) and any written later.
//
// **It does not touch work already stamped for the lane.** A release settles the
// park and nothing else: events sitting in `pending/` or held in `in-progress/`
// for that lane are still there, unmoved, and are the departing listener's to
// drain (the converse skill's account of retirement depends on exactly this).

import {
  ResidentDesignatedPayloadSchema,
  ResidentReleasedPayloadSchema,
  type Actor,
  type DesignateResidentRequest,
  type Resident,
  type ResidentReleaseReason,
  type ThreadSummary,
} from "@corpus/contract";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import { residentOrNull, residentToStored } from "../core/resident.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { AGENTS_KEY, DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { conflict, forbidden, notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { RESIDENT_DESIGNATED, RESIDENT_RELEASED } from "../queue/lanes.js";
import { MENTION_TYPE, resolveMentionTarget, unaddressableTarget } from "./mentions.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import { EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

/**
 * The two event types this module produces (SPEC.md §7). Both members of the
 * contract's `CORE_QUEUE_EVENT_TYPES`, pinned by this module's test rather than
 * spelled as indices into that tuple — exactly as `COMMENT_CREATED` is.
 *
 * **Defined in `queue/lanes.ts` and re-exported here** (SERVER-111,
 * SERVER-128): the reason the names matter in a second place is the lane
 * carve-out — both go to the orchestrator's lane whoever is designated — and
 * that rule has to recognise the types this module produces. Two spellings of
 * either would be an announcement routed to the lane it announces: a designation
 * that starts no listener, or a release read by the listener it ends and by
 * nobody who could relaunch one.
 */
export { RESIDENT_DESIGNATED, RESIDENT_RELEASED } from "../queue/lanes.js";

export const AGENT_DESIGNATE_MESSAGE =
  "designating a resident is user-only; a resident claims a conversation and everything that " +
  "grows out of it, and an agent that could designate would be choosing who answers a person's " +
  "messages";

export const AGENT_RELEASE_MESSAGE =
  "releasing a resident is user-only; it is the other half of the same user-only state, and an " +
  "agent able to release could quietly stop being resident in a conversation a person put it in";

export const NOT_STANDALONE_MESSAGE =
  "only a standalone thread may have a resident — a thread on a document is about that document, " +
  "and a resident owns a conversation rather than a passage";

export interface ResidentChange {
  readonly thread: ThreadSummary;
  /**
   * `null` when nothing was written — a re-designation of the same agent *at the
   * same weight*, or a release with nothing to release.
   */
  readonly result: MutationResult | null;
  /** The `resident.designated` event; `null` for a release, which enqueues none. */
  readonly eventId: string | null;
  /**
   * The `resident.released` event (SERVER-128); `null` when nothing was
   * released.
   *
   * A **release** sets it and leaves {@link eventId} null. A **designation**
   * sets it only when it displaced a *different* resident — reason `replaced`,
   * carrying the occupant that left — and then both fields are set, in that
   * order on the queue: the lane's old listener learns it is over before the
   * newcomer's launch instruction lands.
   */
  readonly releasedEventId: string | null;
}

/**
 * Every key a designation or a release makes stale.
 *
 * `["agents"]` is the roster's (SPEC.md §7's "who is running is a read, never a
 * push"): a lane appears when a thread is designated and disappears when it is
 * released, so both ends of this module change what `GET /api/agents` answers.
 * `["tree"]` is deliberately absent and `mayChangeTree` left unset — a resident
 * is only ever designated on a **standalone** thread, which belongs to no
 * `data/docs/` folder, so no badge can move.
 */
const residentKeys = (id: string) => [DOCS_KEY, docKey(id), threadKey(id), AGENTS_KEY];

/** The thread, refused unless it may have a resident at all (§7). */
function requireStandalone(thread: LoadedThread): LoadedThread {
  if (thread.parent !== null) throw conflict(NOT_STANDALONE_MESSAGE);
  return thread;
}

/**
 * The payload AGENT-026's orchestrator reads to launch a listener: which
 * conversation was designated, who to launch there, and what to launch them at.
 *
 * The resident is carried resolved — the whole `Resident`, the same object the
 * response carries — for the reason the response carries it resolved: the
 * consumer would otherwise repeat a lookup this server has already made. **Every
 * field may be null for a general resident**, which is a designation like any
 * other and not a designation of nobody: the listener to launch is the
 * workspace's ordinary agent, with no persona document to read and at whatever
 * weight the launcher picks (SPEC.md §7, SHARED-048).
 *
 * **Built by the contract's own schema, never by hand** (SERVER-129). The
 * hand-written record this replaced named `name` and `docId` and nothing else,
 * so it silently dropped `weight` the moment the field existed — the listener
 * launched at the launcher's guess while the designation said otherwise, and
 * nothing anywhere failed. `parse` cannot drop a field: it copies the schema's
 * shape, so the next field added to `Resident` arrives here without this
 * function being touched.
 */
export const residentDesignatedPayload = (
  threadId: string,
  resident: Resident,
): Record<string, unknown> => ResidentDesignatedPayloadSchema.parse({ threadId, resident });

/**
 * The payload the orchestrator reads to learn a lane returned to it: which
 * conversation, who left, and why (CONTRACT-069, SPEC.md §7).
 *
 * Built by the contract's schema for the reason above, and carrying the resident
 * **as it stood when it left** — for `replaced`, the displaced occupant and
 * never the newcomer, who travels on its own `resident.designated`.
 */
export const residentReleasedPayload = (
  threadId: string,
  resident: Resident,
  reason: ResidentReleaseReason,
): Record<string, unknown> => ResidentReleasedPayloadSchema.parse({ threadId, resident, reason });

/**
 * Announce a release on the orchestrator's lane, and answer with the event's id
 * (SERVER-128).
 *
 * **One release, one event.** Every way a designation ends goes through here —
 * a person's `DELETE` (`released`), resolution (`resolved`, from
 * `threads/status.ts`), and a designation that displaces a live occupant
 * (`replaced`) — so the three cannot come to announce themselves differently.
 * A **lapse** does not come through here and produces nothing: §7's fallback is
 * computed at claim time, writes nothing, and leaves the resident resident.
 *
 * The lane is the orchestrator's, stamped by `queue/lanes.ts` under the same
 * carve-out `resident.designated` has: a released resident does not announce its
 * own end to itself, and the orchestrator is the party that launched the
 * listener and has to learn it is over.
 *
 * **Volume**: one event per release, and a release is a user-only act on one
 * thread, so a designate/release cycle costs two events — the same order as
 * designation alone already cost. Nothing in the server releases on a timer or
 * in a loop.
 */
export async function enqueueResidentReleased(
  workspace: ThreadsWorkspace,
  threadId: string,
  resident: Resident,
  reason: ResidentReleaseReason,
): Promise<string> {
  const event = await workspace.enqueue({
    type: RESIDENT_RELEASED,
    source: EVENT_SOURCE.thread,
    payload: residentReleasedPayload(threadId, resident, reason),
  });
  return event.id;
}

/** The `resident` key as the file itself spells it — the value a write compares against. */
const fileResident = (thread: LoadedThread): Resident | null =>
  residentOrNull(thread.loaded.parsed.data["resident"]);

/**
 * Is this the designation the thread already has? — the one comparison that
 * decides both whether a designation writes and whether it displaced anybody.
 *
 * **Every field of a `Resident`, and it is one function because both callers
 * must agree.** The comparison used to be written inline and named `name` and
 * `docId` only; when `weight` arrived (SERVER-129) a re-designation at a new
 * level would have read as unchanged, leaving the file saying one thing and the
 * running listener doing another with nothing to see. A field added to
 * `Resident` later has to be added here — nothing will fail to compile — so this
 * docblock is the reminder, and `resident.test.ts` pins one case per field.
 */
const sameResident = (a: Resident, b: Resident): boolean =>
  a.name === b.name && a.docId === b.docId && a.weight === b.weight;

/**
 * How a commit subject names a resident designated with **no** profile.
 *
 * A word here and nowhere else. `Resident.name` stays null on every surface a
 * person picks from — the roster, the composer's recipient list, the board badge
 * — because a synthesised name there would sit beside real profile names with
 * nothing to tell them apart, and could collide with an agent-def titled the
 * same (CONTRACT-061). A `git log` subject is prose about what happened, chooses
 * nothing and is matched against nothing, so it may say in words what the field
 * says by being absent.
 */
const GENERAL_RESIDENT_SUBJECT = "general resident";

/**
 * The `Resident` a request designates: the resolved profile it named, or §7's
 * general resident when it named none.
 *
 * **Absence is the general case and never reaches the lookup**, which is what
 * makes designating require nothing to exist in the workspace first. A name that
 * *is* given still resolves the way a `@mention` of it resolves (§8, through the
 * same index) — so a designation and a mention can never name different
 * documents — and still 404s when it misses: a typo is refused rather than
 * degraded to a general resident, because a typo that looked like it worked is
 * the worse outcome. A blank name never gets here at all; `AgentNameSchema`
 * makes it a `400`, which is the distinction between dropping a name by accident
 * and asking for no profile.
 *
 * **The miss names the near-miss when there is one** (SERVER-125). A
 * `type: agent-def` document filed outside `.claude/agents/` is a document
 * *about* a persona and is addressable by nothing — but it is titled like a
 * persona, listed like one, and until this issue it designated like one. A
 * refusal that said only "no agent named Bookkeeper" would leave the one person
 * who is looking straight at such a document unable to tell a typo from a file
 * one directory away from working, so the path is named and so is what is wrong
 * with it. This is the only surface that can say it: a mention that resolves to
 * nothing carries a bare token and no document.
 *
 * **The refusal quotes the spelling that was looked up, and quotes no mention
 * token** (PR #50 NIT 9). `AgentNameSchema` accepts any non-blank single line, so
 * a designation may arrive as `" Legacy Analyst "`; the lookups trim it
 * (`mentions.ts`) and the message therefore names the trimmed form, or it would
 * report a miss on a spelling nothing searched for. The message used to build
 * `` `@${name}` `` out of it, which was worse than untidy: a mention token is
 * `[A-Za-z0-9_-]+` (`mentions.ts`'s `TOKEN`), so neither the surrounding spaces
 * nor the inner one in a titled `Legacy Analyst` can appear in one — the refusal
 * was quoting a string nobody can type, as the thing that fails to resolve. What
 * it means is said in words instead.
 *
 * **The weight is taken verbatim and checked against nothing** (SERVER-129,
 * SPEC.md §7's rider signed 2026-08-19). It is a level key from the workspace's
 * own tier table — the orchestrate skill's text, which §2.4 lets a workspace
 * edit on its own schedule and which this server never reads — so a check here
 * could only be against a list the server must not hold, and would refuse a
 * level the workspace's own guidance defines. The contract's
 * `RequestedWeightSchema` has already bounded its *shape*, which is the whole of
 * what is checkable. `undefined` becomes `null`: the request has one spelling of
 * "no level" and the `Resident` has one, and this is where they meet.
 */
function residentFor(
  projection: ProjectionDb,
  name: string | undefined,
  weight: string | undefined,
): Resident {
  const chosen = weight ?? null;
  if (name === undefined) return { name: null, docId: null, weight: chosen };
  const target = resolveMentionTarget(projection, MENTION_TYPE, name);
  if (target === null) {
    const wanted = name.trim();
    const inert = unaddressableTarget(projection, MENTION_TYPE, name);
    throw notFound(
      inert === null
        ? `no agent named ${wanted} in this workspace — a designation names an agent-def the ` +
            "way a mention does"
        : `no agent named ${wanted} in this workspace — ${inert.path} declares ` +
            "`type: agent-def` but is not under `.claude/agents/`, so nothing loads it as a " +
            "subagent and neither a mention nor a designation resolves to it; a persona has to " +
            "live in that root",
    );
  }
  // The **resolved** name is what gets stored, never the caller's spelling.
  return { name: target.name, docId: target.docId, weight: chosen };
}

/**
 * Designate `id`'s resident: the profile `request.name` names, or a general
 * resident when it names none.
 *
 * An **archived** agent-def designates rather than being refused, which is the
 * mention doctrine applied here: never silently ignore, never silently refuse.
 * Its archived-ness is not reported on this response, because `Resident` carries
 * a name and a document id and no status; the `docId` names the document, so a
 * reader that cares can see what state it is in.
 *
 * **Every call enqueues `resident.designated`, including one that writes
 * nothing.** Designating the resident a thread already has leaves the file
 * untouched — the state asked for is the state that holds, and stamping
 * `updated` for it would report a change nobody made — but the event is still
 * written, because it is how a person asks for a listener that is no longer
 * running to be launched again, and there is no other verb for that.
 *
 * **A different weight is a different state, so it writes** (SERVER-129). §7's
 * rider makes a resident's weight a property of the designation — a running
 * agent cannot become another one without discarding the conversation it is
 * holding — so re-designating the same profile at a new level is not the
 * re-announce above: the file changes, and the listener has to be relaunched.
 *
 * **A designation that displaces a *different* resident releases it first**
 * (SERVER-128, reason `replaced`). A thread has one resident or none, so
 * designating over a live one is a release and a designation, and the two travel
 * as two events in that order. "Different" is by the same comparison the write
 * turns on, weight included: the re-announce above displaces nobody and enqueues
 * no release, while a weight change ends the old listener's run of the lane
 * exactly as a profile change does.
 */
export async function designateResident(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  request: DesignateResidentRequest,
): Promise<ResidentChange> {
  if (actor === "agent") throw forbidden(AGENT_DESIGNATE_MESSAGE);

  // Read and refuse before taking the lane, so a request that can never write
  // does not queue behind somebody's save — then read again inside it, because
  // that copy is the one this write acts on (SERVER-035's rule).
  requireStandalone(loadThread(workspace, id));

  return mutex.run(id, async (): Promise<ResidentChange> => {
    const thread = requireStandalone(loadThread(workspace, id));
    const resident = residentFor(workspace.projection, request.name, request.weight);

    // Every field compared, so replacing along any of them is a write: general →
    // profiled moves `name`, profiled → general moves it back, one profile →
    // another moves both, and the same profile at a new level moves `weight`
    // (SERVER-129).
    const current = fileResident(thread);
    const unchanged = current !== null && sameResident(current, resident);

    const named = resident.name ?? GENERAL_RESIDENT_SUBJECT;
    const result = unchanged
      ? null
      : await writeResident(workspace, thread, actor, resident, {
          subject: `resident designate: ${named} on ${thread.title} (${id}) by ${actor}`,
        });

    // The displaced occupant's release (SERVER-128), before the newcomer's
    // launch instruction and after the write that displaced it: the lane's old
    // listener learns it is over from an event, and its park ends on this
    // enqueue. `current !== null && !unchanged` is exactly "somebody else was
    // here" — a first designation displaces nobody, and the re-announce above
    // displaces the resident it re-announces, which is not a departure.
    //
    // The occupant is reported as `thread.resident` rather than as the raw
    // `current`, so its `docId` is the one every other surface would have shown
    // for it a moment earlier. The two differ only for a parented thread, which
    // `requireStandalone` has already refused.
    const displaced = current === null || unchanged ? null : thread.resident;
    const releasedEventId =
      displaced === null
        ? null
        : await enqueueResidentReleased(workspace, id, displaced, "replaced");

    // After the write, inside the lane, exactly as a turn's `comment.created`
    // is: the event announces a designation that already stands on disk. §7 puts
    // it on the **orchestrator's** lane whoever is designated — the resident
    // does not announce itself to itself — which is one of exactly two carve-outs
    // to the lane rule, and is SERVER-111's to enforce at enqueue time. Nothing
    // here names a recipient.
    const event = await workspace.enqueue({
      type: RESIDENT_DESIGNATED,
      source: EVENT_SOURCE.thread,
      payload: residentDesignatedPayload(id, resident),
    });

    return {
      thread: toThreadSummary(result === null ? thread : loadThread(workspace, id)),
      result,
      eventId: event.id,
      releasedEventId,
    };
  });
}

/**
 * Release `id`'s resident, returning its scope to ordinary routing.
 *
 * **Idempotent**: releasing a thread that has no resident writes nothing,
 * commits nothing and announces nothing — the caller often cannot know, and a
 * release with nothing to release is a no-op rather than an error. It still
 * answers with the thread, because a release that *does* write can raise §11's
 * warnings and a rejected auto-commit has to be visible somewhere.
 *
 * No refusal for a parented thread: the routes cannot put a resident on one, but
 * a hand-edited file can, and a release that refused the one thread whose key
 * ought not to be there would leave it there forever.
 *
 * **A release that releases somebody enqueues `resident.released`, reason
 * `released`** (SERVER-128) — the symmetry designation always had, and the thing
 * whose absence meant a person could stop a resident only by resolving the
 * conversation or by waiting for the orchestrator to notice. The event is what
 * ends the resident's park, too (see this module's header), so the act has an
 * observable end measured in one HTTP round trip rather than in one rearm
 * window.
 *
 * **"Releases somebody" is `thread.resident !== null`, not the key's presence.**
 * The two differ exactly where the key is not a designation — a parented
 * thread's, or a plugin's `resident:` meaning something else — and those are
 * cleared without an announcement because nothing was ever a lane there: no
 * event was ever routed to it, and no listener was ever launched for it. What is
 * *written* still turns on the key, so a stray one is still removed.
 */
export async function releaseResident(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
): Promise<ResidentChange> {
  if (actor === "agent") throw forbidden(AGENT_RELEASE_MESSAGE);
  loadThread(workspace, id);

  return mutex.run(id, async (): Promise<ResidentChange> => {
    const thread = loadThread(workspace, id);
    // Read off the file rather than off `thread.resident`, which a parented
    // thread reports as null however its frontmatter reads (`core/resident.ts`).
    if (!Object.hasOwn(thread.loaded.parsed.data, "resident")) {
      return {
        thread: toThreadSummary(thread),
        result: null,
        eventId: null,
        releasedEventId: null,
      };
    }

    const released = thread.resident;
    const result = await writeResident(workspace, thread, actor, null, {
      subject: `resident release: ${thread.title} (${thread.id}) by ${actor}`,
    });

    // After the write, so the announcement describes a lane that has already
    // stopped being one: the resident's next park is refused by
    // `assertScopeIsLane` against the projection this write has just updated,
    // and the enqueue that carries the announcement is also what ends the park
    // it is holding now.
    const releasedEventId =
      released === null ? null : await enqueueResidentReleased(workspace, id, released, "released");

    return {
      thread: toThreadSummary(loadThread(workspace, thread.id)),
      result,
      eventId: null,
      releasedEventId,
    };
  });
}

/**
 * The write both halves share: one frontmatter field, stamped, validated,
 * committed and announced.
 *
 * `null` **removes** the key rather than writing `resident: null` — §7 makes
 * dissolving the absence of a resident and never a third state, and a `null` on
 * disk would be a third spelling of it.
 *
 * The value written is `core/resident.ts`'s stored shape, the exact inverse of
 * the reader every path asks — which is why a designation that chose no weight
 * writes no `weight:` key rather than a null one (SERVER-129).
 */
async function writeResident(
  workspace: ThreadsWorkspace,
  thread: LoadedThread,
  actor: Actor,
  resident: Resident | null,
  commit: { readonly subject: string },
): Promise<MutationResult> {
  const text = serializeDocument(
    setFrontmatterFields(thread.loaded.parsed, {
      resident: resident === null ? undefined : residentToStored(resident),
      updated: formatInstant(workspace.now()),
    }),
  );
  const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

  return runMutation(workspace, {
    docId: thread.id,
    actor,
    warnings,
    plan: {
      operations: [{ kind: "write", path: thread.loaded.path, content: text }],
      stage: [thread.loaded.path],
      project: [thread.loaded.path],
      unproject: [],
      commit: {
        subject: commit.subject,
        // Out of §4's session folding, for the reason the anchor repair is out
        // of it: this is a decision a person made, not a continuation of
        // whatever they were saving, and folding it into an editing session's
        // commit would leave `git log` with no record that it happened. It is
        // deliberately **not** one of §4's *acts* either — that list is closed
        // and names none of this — so no open window is closed for it.
        squash: false,
      },
      keys: residentKeys(thread.id),
    },
  });
}
