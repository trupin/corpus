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
// the drift (§14).

import {
  ThreadAgentSchema,
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
} from "../core/index.js";
import { loadDocument, type LoadedDocument } from "../docs/index.js";
import { notFound } from "../errors.js";
import type { ThreadsWorkspace } from "./workspace.js";

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
  readonly turns: Turn[];
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
export function loadThread(workspace: ThreadsWorkspace, id: string): LoadedThread {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  if (loaded.row.type !== "thread") throw notFound(`no thread with id ${id}`);
  return readThread(workspace, loaded);
}

/** The same shaping, for a {@link LoadedDocument} the caller already has in hand. */
export function readThread(workspace: ThreadsWorkspace, loaded: LoadedDocument): LoadedThread {
  const data = loaded.parsed.data;
  const turns = parseTurns(loaded.parsed.body);
  const tags: unknown = data["tags"];

  // A thread with neither stamp and no turns is not something the server can
  // produce, but a hand-written file can be — and `ThreadSchema` requires both
  // instants, so there has to be an answer. The turns are the honest one: they
  // are when the conversation demonstrably happened.
  const fallback = turns[0]?.ts ?? formatInstant(workspace.now());
  const created = asInstant(data["created"]) ?? fallback;
  const agent = ThreadAgentSchema.safeParse(data["agent"]);

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
    parent: asId(data["parent"], isDocumentId),
    anchor: asId(data["anchor"], isAnchorId),
    agent: agent.success ? agent.data : "none",
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
    created: thread.created,
    updated: thread.updated,
    turnCount: thread.turns.length,
    lastAuthor: last?.author ?? "user",
    lastTs: last?.ts ?? thread.updated,
  };
}
