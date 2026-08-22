// Reading a thread off disk and shaping it for the wire (SPEC.md §6, §9.2).
//
// The file is the source of truth, so every field below comes from the bytes on
// disk — the projection contributes only the id → path mapping and the three
// fields a document root can override, exactly as `docs/read.ts` does.
//
// **Lenient by design.** `FileThreadFrontmatterSchema` is the strict §6 shape
// and is what validation reports against, but a *read* must not 500 on a
// hand-written thread that omits `created` or spells `agent` wrong: the turns
// are still there and the conversation is still a conversation. Each field falls
// back to something true rather than failing, and `doc check` is what reports
// the drift (§11).

import {
  ThreadAgentSchema,
  type Resident,
  type Thread,
  type ThreadAgent,
  type ThreadStatus,
  type ThreadSummary,
  type Turn,
} from "@corpus/contract";
import {
  formatInstant,
  isAnchorId,
  isDocumentId,
  normalizeInstant,
  parseTurns,
  turnModelsOf,
  withTurnModels,
} from "../core/index.js";
import { storedResident } from "../core/resident.js";
import { loadDocument, type LoadedDocument } from "../docs/index.js";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { MENTION_TYPE, resolveMentionTarget } from "./mentions.js";

/**
 * What *reading* a thread needs, which is strictly less than what writing one
 * does: where the files are, what is indexed, and a clock for the one field a
 * hand-written file can omit entirely.
 *
 * Declared here rather than taking a whole {@link import("./workspace.js").ThreadsWorkspace}
 * because a read touches no git repository, no invalidation bus and no queue —
 * and a read-only surface (the context pack, SERVER-047) should be constructible
 * in a test without standing up a write path it never uses. Every
 * `ThreadsWorkspace` satisfies it, so no caller changes.
 */
export interface ThreadReader {
  readonly workspaceRoot: string;
  readonly projection: ProjectionDb;
  readonly now: () => number;
}

export interface LoadedThread {
  readonly loaded: LoadedDocument;
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly updated: string;
  readonly status: ThreadStatus;
  readonly tags: string[];
  readonly parent: string | null;
  readonly anchor: string | null;
  readonly agent: ThreadAgent;
  /** §7's resident, its `docId` re-resolved from the name (see {@link currentResident}). */
  readonly resident: Resident | null;
  readonly turns: Turn[];
}

/**
 * The stored designation, with its `docId` refreshed against the workspace as it
 * now stands (SPEC.md §7, CONTRACT-051: *"resolved at designation time and
 * re-read on every response"*).
 *
 * The re-read matters because an agent-def's id is **derived from its path**
 * when the file carries none — the synthetic id every `.claude/agents/*.md`
 * gets — so moving or renaming one gives the same agent a different id, and a
 * response repeating the stored one would send a reader to a document that is no
 * longer there.
 *
 * **The name is the durable half and is never rewritten here.** §7's designation
 * survives its persona going missing, so the name comes back exactly as it was
 * written and a reader can still see *who* was designated. Handling a gone
 * persona is the converse skill's job (AGENT-025), not this reader's.
 *
 * **A name that resolves to nothing answers `docId: null`, not the stored id.**
 * The contract's `docId` is *"the document `name` resolves to right now"*, and
 * §7's rider requires a missing profile be **reported rather than silently
 * substituted** — repeating the id the designation stored would send a reader to
 * a document the workspace no longer has, which is the very failure the re-read
 * above exists to prevent. `{name: "researcher", docId: null}` is that report,
 * and it is deliberately distinguishable from `{name: null, docId: null}`, which
 * is a **general** resident that named no profile in the first place.
 *
 * **A general resident is returned untouched, without a lookup.** There is no
 * name to resolve, and `ResidentSchema`'s refinement already guarantees a null
 * name comes with a null id.
 *
 * **`weight` is carried through unchanged, and is the one field here that is
 * *not* re-resolved** (SERVER-129). `docId` is re-read because it answers "what
 * does this name point at now", a question about the workspace. A weight answers
 * "what did the person choose", a question about the designation, and the
 * workspace holds nothing to check it against — the tier table is the
 * orchestrate skill's own text, which the server never reads. So a level that no
 * longer exists comes back exactly as it was written, and §7's weight rider puts
 * the report of it in the launcher's first reply rather than here.
 */
export function currentResident(
  projection: ProjectionDb,
  stored: Resident | null,
): Resident | null {
  if (stored === null) return null;
  if (stored.name === null) return { name: null, docId: null, weight: stored.weight };
  const target = resolveMentionTarget(projection, MENTION_TYPE, stored.name);
  return { name: stored.name, docId: target?.docId ?? null, weight: stored.weight };
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const asInstant = (value: unknown): string | null => {
  const text = asString(value);
  return text === null ? null : normalizeInstant(text);
};

const asId = (value: unknown, isValid: (candidate: string) => boolean): string | null => {
  const text = asString(value);
  return text !== null && isValid(text) ? text : null;
};

/**
 * Read the thread `id` names, or throw the contract's 404.
 *
 * A document that exists but is not a thread is a 404 on *this* surface rather
 * than a 400: `GET /api/threads/{id}` addresses threads, and "there is no thread
 * with that id" is exactly true of a note.
 */
export function loadThread(workspace: ThreadReader, id: string): LoadedThread {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  if (loaded.row.type !== "thread") throw notFound(`no thread with id ${id}`);
  return readThread(workspace, loaded);
}

/** The same shaping, for a {@link LoadedDocument} the caller already has in hand. */
export function readThread(workspace: ThreadReader, loaded: LoadedDocument): LoadedThread {
  const data = loaded.parsed.data;
  // The body says which turns there are; the frontmatter says which model wrote
  // each (SPEC.md §6, CONTRACT-043). Joined here, once, so every reader that
  // goes through the server — the thread route, the context pack, the summary —
  // reads a turn with its model on it and nobody re-derives the join. A turn the
  // map says nothing about keeps the parser's `null`: §10's nothing, not a guess.
  const turns = withTurnModels(parseTurns(loaded.parsed.body), turnModelsOf(data));
  const tags: unknown = data["tags"];

  // A thread with neither stamp and no turns is not something the server can
  // produce, but a hand-written file can be — and `ThreadSchema` requires both
  // instants, so there has to be an answer. The turns are the honest one: they
  // are when the conversation demonstrably happened.
  const fallback = turns[0]?.ts ?? formatInstant(workspace.now());
  const created = asInstant(data["created"]) ?? fallback;
  const agent = ThreadAgentSchema.safeParse(data["agent"]);
  const parent = asId(data["parent"], isDocumentId);

  return {
    loaded,
    id: loaded.row.id,
    title: asString(data["title"]) ?? loaded.row.title,
    created,
    updated: asInstant(data["updated"]) ?? turns.at(-1)?.ts ?? created,
    // The `documents` row carries the *document* status, whose third value
    // (`archived`) is not a thread state — an archived thread is still an
    // unresolved conversation (this is `docs/read.ts`'s rule, kept identical).
    status: loaded.row.status === "resolved" ? "resolved" : "open",
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    parent,
    anchor: asId(data["anchor"], isAnchorId),
    agent: agent.success ? agent.data : "none",
    resident: currentResident(workspace.projection, storedResident(data["resident"], parent)),
    turns,
  };
}

/** `GET /api/threads/{id}` — the thread and every turn, oldest first. */
export function toWireThread(thread: LoadedThread): Thread {
  return {
    id: thread.id,
    title: thread.title,
    created: thread.created,
    updated: thread.updated,
    status: thread.status,
    tags: [...thread.tags],
    parent: thread.parent,
    anchor: thread.anchor,
    agent: thread.agent,
    resident: thread.resident === null ? null : { ...thread.resident },
    turns: thread.turns.map((turn) => ({ ...turn })),
  };
}

/**
 * The list row (SPEC.md §9.1's `threads` columns), built from the file rather
 * than queried back out of SQLite. The values are identical — the write path
 * re-projects before it responds — and reading the bytes it just wrote keeps the
 * response independent of a projection column being nullable for rows this
 * server did not write.
 */
export function toThreadSummary(thread: LoadedThread): ThreadSummary {
  const last = thread.turns.at(-1);
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    parent: thread.parent,
    anchor: thread.anchor,
    agent: thread.agent,
    // §7's resident (CONTRACT-051, SERVER-109), read off the thread's own
    // frontmatter. `null` for a thread nobody designated — which is a fact about
    // it rather than a missing value — and always `null` on an anchored or
    // whole-document thread, because only a standalone thread may designate.
    resident: thread.resident === null ? null : { ...thread.resident },
    created: thread.created,
    updated: thread.updated,
    turnCount: thread.turns.length,
    lastAuthor: last?.author ?? "user",
    lastTs: last?.ts ?? thread.updated,
  };
}
