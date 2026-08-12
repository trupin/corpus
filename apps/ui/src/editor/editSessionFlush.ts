import { useCorpusClient, type CorpusClient } from "@corpus/kit";
import { useEffect } from "react";
import { onPageHide } from "../abandon/pagehide.js";

/**
 * SPEC.md §4's **close** path: the reader closed, so end the edit session now.
 *
 * > *Every user edit session on a document ends one of two ways: the reader
 * > closes (the UI flushes the session), or the document goes inactive for a few
 * > minutes while open (default 3 minutes…). Either way the server emits one
 * > `doc.edited` queue event…*
 *
 * The server owns the second ending and needs nothing from the UI for it. This
 * module owns the first, and its entire job is deciding **when a reader has
 * closed** — because the reader has several exits and only some of them end an
 * editing sitting.
 *
 * ## What counts as a close
 *
 * A close is *the last editing surface for this document going away*, not any
 * one surface going away, and not any of the smaller exits that look like one:
 *
 * - **Closing the reader, or navigating it onto another document** — the
 *   editor unmounts (the reader keys `DocEditor` by document id), the count
 *   reaches zero, and that is a close.
 * - **Focus mode over a column already showing the document** — two surfaces,
 *   one document. Closing focus leaves the column's editor mounted, so the
 *   count does not reach zero and nothing is flushed. Opening focus does not
 *   flush either, for the same reason in reverse. Both are the *same sitting*.
 * - **Back and forward through a navigation stack** — returning to a document
 *   does not re-open a session, so leaving it again flushes nothing: there is
 *   no landed write to acknowledge until the user types again.
 * - **Blur, alt-tab, ten seconds of not typing** — not closes, and pointedly
 *   not wired here. A sitting is longer than any pause in it; binding the
 *   session to a short idle is the defect CONTRACT-031 was filed to avoid,
 *   because §4's "distinct and longer window" becomes unreachable and one
 *   sitting fragments into an acknowledgment per typing burst. (The short-idle
 *   timer this used to name was §7's edit lock, which SHARED-041 removed with
 *   the rest of the mechanism.)
 * - **The tab going away** — a close, covered below.
 *
 * ## Why a document is only flushed after a write of its own
 *
 * A session is opened by the server on the first *editor save that lands a
 * commit* — so a document that was opened and read has none, and a flush for it
 * would be a request that can only ever be a no-op. Reading is the common case;
 * a request per reader close is not free just because the route is idempotent.
 * So {@link endEditWrite} records that a write landed, and only a document
 * carrying that mark is ever flushed. It is also what stops a close from
 * flushing twice: the mark is cleared when the flush is issued.
 *
 * ## Why it waits for writes in flight
 *
 * The teardown order on a reader close is: the editor unmounts, autosave sends
 * its buffered `PUT`, and the surface count reaches zero — all in one commit,
 * with the `PUT` still on the wire. Flushing there would end the session over a
 * range that stops one save short, and the `PUT` landing behind it would open a
 * *second* session that nobody is left to close, so the last sentence typed
 * would wait out the full inactivity window. The sweep therefore requires both
 * *no surfaces* and *no writes in flight*, and re-arms when the last write
 * settles.
 *
 * ## Best effort, and honestly so
 *
 * A flush is issued once and never retried: a failed request costs a *delay*,
 * because §4's inactivity window is the guaranteed backstop and is still
 * running. Nothing here surfaces an error — the user is leaving, and a toast
 * about an acknowledgment they did not ask for would be noise on the way out.
 */

/**
 * How long the sweep waits after a document becomes flushable.
 *
 * It buys two things. A surface **handoff** — focus mode opening over a column
 * that has to unmount, a reader remounting across two commits — reaches zero
 * transiently, and a flush there would split one sitting in half. And a burst
 * of teardown (a column closing several readers) settles into one pass instead
 * of one timer each. Short enough that "I closed the document" and "the agent
 * knows" stay the same moment.
 */
export const EDIT_SESSION_SETTLE_MS = 300;

interface DocSession {
  /** Editing surfaces currently showing this document. */
  surfaces: number;
  /** User writes to this document currently on the wire. */
  writes: number;
  /** A write has landed since the last flush, so the server may hold a session. */
  open: boolean;
}

const docs = new Map<string, DocSession>();

/**
 * The client the flush is issued through, installed by {@link useEditSessionFlusher}.
 *
 * Module state rather than context because every trigger here fires *after* the
 * component that would have held the context is gone: a surface release runs in
 * an unmount cleanup, a write settles on a promise the unmounted hook left
 * behind, and `pagehide` belongs to no component at all.
 */
let client: CorpusClient | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;

function stateOf(docId: string): DocSession {
  const existing = docs.get(docId);
  if (existing !== undefined) return existing;
  const created: DocSession = { surfaces: 0, writes: 0, open: false };
  docs.set(docId, created);
  return created;
}

/** Nothing to remember about a document with no surface, no write and no session. */
function prune(docId: string, state: DocSession): void {
  if (state.surfaces === 0 && state.writes === 0 && !state.open) docs.delete(docId);
}

function isFlushable(state: DocSession): boolean {
  return state.open && state.surfaces === 0 && state.writes === 0;
}

/**
 * Issues the flush, and never looks at the answer.
 *
 * Both callers clear `open` *before* calling this, which is what makes a close
 * flush once: the failure that matters is a duplicate, not a miss, and a request
 * that never arrives is made good by the inactivity window. A rejection is
 * therefore swallowed rather than retried — including the `404` for a document
 * the workspace no longer has, which is not actionable on the way out.
 */
function send(docId: string): void {
  const target = client;
  if (target === null) return;
  void target.flushEditSession(docId).catch(() => undefined);
}

function sweep(): void {
  timer = null;
  for (const [docId, state] of [...docs]) {
    if (!isFlushable(state)) continue;
    state.open = false;
    prune(docId, state);
    send(docId);
  }
}

function schedule(): void {
  if (timer !== null) return;
  let any = false;
  for (const state of docs.values()) {
    if (isFlushable(state)) {
      any = true;
      break;
    }
  }
  if (!any) return;
  timer = setTimeout(sweep, EDIT_SESSION_SETTLE_MS);
}

/**
 * Registers an editing surface for `docId`; the returned function releases it.
 *
 * The release is idempotent, because React invokes an effect's cleanup once per
 * effect but a caller may hold the closure past that (and StrictMode replays
 * mount/cleanup/mount, which must net to one surface, not zero).
 */
export function retainEditSurface(docId: string): () => void {
  if (docId === "") return () => undefined;
  stateOf(docId).surfaces += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const state = docs.get(docId);
    if (state === undefined) return;
    state.surfaces -= 1;
    prune(docId, state);
    schedule();
  };
}

/** A user write to this document is on the wire; hold the flush until it answers. */
export function beginEditWrite(docId: string): void {
  if (docId === "") return;
  stateOf(docId).writes += 1;
}

/**
 * That write answered. `landed` is whether the server accepted it — and so
 * whether it may have opened (or extended) a session worth flushing.
 */
export function endEditWrite(docId: string, landed: boolean): void {
  const state = docs.get(docId);
  if (state === undefined) return;
  if (state.writes > 0) state.writes -= 1;
  if (landed) state.open = true;
  prune(docId, state);
  schedule();
}

/**
 * The tab is going away, so every open session is closing — surfaces and
 * in-flight writes included, because neither will exist a moment from now.
 *
 * Registered in the unload sequence's `settle` phase so it runs after autosave
 * and the frontmatter form have put their final `PUT`s on the wire. That
 * ordering is the best the platform allows and not a guarantee: the two
 * requests race at the server, and a `PUT` that arrives after this opens a
 * fresh session that ends the ordinary way, three minutes later. A delayed
 * acknowledgment, never a lost one.
 */
export function flushEditSessionsOnUnload(): void {
  for (const [docId, state] of [...docs]) {
    if (!state.open) continue;
    state.open = false;
    prune(docId, state);
    send(docId);
  }
}

/** Test seam: the registry is module state and a suite must be able to reset it. */
export function resetEditSessionFlush(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  docs.clear();
  client = null;
}

/** Test seam: the transport, injectable without a provider. */
export function setEditSessionClient(next: CorpusClient | null): void {
  client = next;
}

/**
 * Declares that this component is an editing surface for `docId`.
 *
 * Mounted by `DocEditor`, which is the only surface in the app that can open a
 * session: a read-only view issues no writes, so counting one would only delay
 * a flush the reader beside it had earned.
 */
export function useEditSurface(docId: string): void {
  useEffect(() => retainEditSurface(docId), [docId]);
}

/**
 * Gives the registry a client and a tab-close hook, for as long as the app is up.
 *
 * Mounted once, by the shell, rather than by a reader: the flush is issued after
 * the reader is gone, so a registration that lived and died with one would never
 * fire for the close it exists to serve.
 */
export function useEditSessionFlusher(): void {
  const corpus = useCorpusClient();
  useEffect(() => {
    setEditSessionClient(corpus);
    const off = onPageHide("settle", flushEditSessionsOnUnload);
    return () => {
      off();
      setEditSessionClient(null);
    };
  }, [corpus]);
}
