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
// **It does not wake a parked listener on release.** §7 wants a scoped `idle` on
// a dissolved lane to return promptly, but the parking lot is lane-blind until
// SERVER-111 keys it, so there is no per-lane waiter here to notify. That half
// lands with lanes rather than being faked here.

import type { Actor, DesignateResidentRequest, Resident, ThreadSummary } from "@corpus/contract";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import { residentOrNull } from "../core/resident.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { AGENTS_KEY, DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { conflict, forbidden, notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { RESIDENT_DESIGNATED } from "../queue/lanes.js";
import { MENTION_TYPE, resolveMentionTarget, unaddressableTarget } from "./mentions.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import { EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

/**
 * The one event type designation produces (SPEC.md §7). A member of the
 * contract's `CORE_QUEUE_EVENT_TYPES`, pinned by this module's test rather than
 * spelled as an index into that tuple — exactly as `COMMENT_CREATED` is.
 *
 * **Defined in `queue/lanes.ts` and re-exported here** (SERVER-111): the reason
 * the name matters in a second place is the lane carve-out — a
 * `resident.designated` goes to the orchestrator's lane whoever is designated —
 * and that rule has to recognise the type this module produces. Two spellings of
 * it would be a designation that routes to the lane it announces, which starts
 * no listener at all.
 */
export { RESIDENT_DESIGNATED } from "../queue/lanes.js";

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
  /** `null` when nothing was written — a re-designation of the same agent, or a release with nothing to release. */
  readonly result: MutationResult | null;
  /** The `resident.designated` event; `null` for a release, which enqueues none. */
  readonly eventId: string | null;
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
 * conversation was designated, and who to launch there.
 *
 * The resident is carried resolved — `{name, docId}` — for the reason the
 * response carries it resolved: the consumer would otherwise repeat a lookup
 * this server has already made. **Both halves are null for a general resident**,
 * which is a designation like any other and not a designation of nobody: the
 * listener to launch is the workspace's ordinary agent, with no persona document
 * to read (SPEC.md §7, SHARED-048).
 */
export const residentDesignatedPayload = (
  threadId: string,
  resident: Resident,
): Record<string, unknown> => ({
  threadId,
  resident: { name: resident.name, docId: resident.docId },
});

/** The `resident` key as the file itself spells it — the value a write compares against. */
const fileResident = (thread: LoadedThread): Resident | null =>
  residentOrNull(thread.loaded.parsed.data["resident"]);

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
 */
function residentFor(projection: ProjectionDb, name: string | undefined): Resident {
  if (name === undefined) return { name: null, docId: null };
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
  return { name: target.name, docId: target.docId };
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
    const resident = residentFor(workspace.projection, request.name);

    // Both halves compared, so replacing in either direction is a write:
    // general → profiled moves `name`, profiled → general moves it back, and
    // one profile → another moves both.
    const current = fileResident(thread);
    const unchanged =
      current !== null && current.name === resident.name && current.docId === resident.docId;

    const named = resident.name ?? GENERAL_RESIDENT_SUBJECT;
    const result = unchanged
      ? null
      : await writeResident(workspace, thread, actor, resident, {
          subject: `resident designate: ${named} on ${thread.title} (${id}) by ${actor}`,
        });

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
    };
  });
}

/**
 * Release `id`'s resident, returning its scope to ordinary routing.
 *
 * **Idempotent**: releasing a thread that has no resident writes nothing,
 * commits nothing and announces nothing — the caller often cannot know, and a
 * release with nothing to release is a no-op rather than an error. It still
 * answers with the thread, because a release that *does* write can raise §14's
 * warnings and a rejected auto-commit has to be visible somewhere.
 *
 * No refusal for a parented thread: the routes cannot put a resident on one, but
 * a hand-edited file can, and a release that refused the one thread whose key
 * ought not to be there would leave it there forever.
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
      return { thread: toThreadSummary(thread), result: null, eventId: null };
    }

    const result = await writeResident(workspace, thread, actor, null, {
      subject: `resident release: ${thread.title} (${thread.id}) by ${actor}`,
    });

    return { thread: toThreadSummary(loadThread(workspace, thread.id)), result, eventId: null };
  });
}

/**
 * The write both halves share: one frontmatter field, stamped, validated,
 * committed and announced.
 *
 * `null` **removes** the key rather than writing `resident: null` — §7 makes
 * dissolving the absence of a resident and never a third state, and a `null` on
 * disk would be a third spelling of it.
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
      resident: resident ?? undefined,
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
