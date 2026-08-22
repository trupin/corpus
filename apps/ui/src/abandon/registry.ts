import type { DocSnapshot } from "./emptiness";

/**
 * What every surface knows about the documents that are open right now, so the
 * abandon rule (SPEC.md §10) can be decided **at the instant of exit** rather
 * than guessed at from the server a moment later.
 *
 * Three facts have to meet, and they live in three different components:
 *
 * - the **corpus's** copy of the document — the reader has it;
 * - the **editor's** live serialized body, which may be several keystrokes
 *   ahead of the corpus (`useAutosave` debounces at 700 ms);
 * - the **title field's** uncommitted draft, which `FrontmatterForm` holds
 *   until Enter or Save.
 *
 * Asking the server on exit instead would race the very flush the rule has to
 * cooperate with: the buffer that says "the user erased everything" may still
 * be in flight when the reader unmounts. Reading the live state is what makes
 * typed-then-erased-then-left work without a second round trip.
 *
 * **Module state rather than context**, for the same reason the editing
 * registry is: a document can be open in two column readers and in focus mode
 * at once, and all of them have to agree about whether it is still displayed.
 * That is also why "displayed" is a **count**: closing focus mode over a
 * document its column still has open is not an exit.
 */

/** The document as the corpus holds it, published by whichever reader shows it. */
const known = new Map<string, DocSnapshot>();
/**
 * The body a document was born with, published by the create flow.
 *
 * A template's prefill (SPEC.md §10) is content the *product* put there, not
 * content the user wrote, and a document still holding exactly it is still
 * untouched. Only this session can know it — hence a registry entry rather
 * than a derivation.
 *
 * **It is the one map that outlives its document, deliberately** (PR #12
 * review, NIT 24). {@link forgetDoc} leaves it alone — see the note there — so
 * an entry is dropped only when the document is actually deleted
 * ({@link forgetPristineBody}). A document created and *kept* therefore leaves
 * one id and one body string here until the tab is reloaded. That is the whole
 * cost: it is bounded by documents created in this session, it is the size of
 * their template prefill, and it is not a growing-per-navigation leak.
 * Trimming it earlier is what broke the `＋` path once already.
 */
const pristine = new Map<string, string>();
/** Uncommitted title text, published by the frontmatter form. */
const titleDrafts = new Map<string, string>();
/** The editor's live serialized body, published by autosave. */
const bodyDrafts = new Map<string, string>();
/** How many readers currently display this document. */
const displayed = new Map<string, number>();
/**
 * Documents whose removal has been decided.
 *
 * Read by `useAutosave.flush`: once a document is being abandoned, sending its
 * buffer is at best a wasted write and at worst a `PUT` racing a `DELETE`.
 */
const abandoned = new Set<string>();
/** Deletions already under way — the guard against two hosts racing one exit. */
const deleting = new Set<string>();
const listeners = new Set<(docId: string) => void>();

export function publishDoc(docId: string, snapshot: Omit<DocSnapshot, "pristineBody">): void {
  if (docId === "") return;
  known.set(docId, { ...snapshot, pristineBody: pristine.get(docId) ?? null });
}

/** Records the body a freshly created document was handed by the server. */
export function publishPristineBody(docId: string, body: string): void {
  if (docId === "") return;
  pristine.set(docId, body);
}

/** `null` clears the draft — the field was reverted or saved. */
export function publishTitleDraft(docId: string, title: string | null): void {
  if (docId === "") return;
  if (title === null) titleDrafts.delete(docId);
  else titleDrafts.set(docId, title);
}

/** `null` clears the buffer. */
export function publishBodyDraft(docId: string, body: string | null): void {
  if (docId === "") return;
  if (body === null) bodyDrafts.delete(docId);
  else bodyDrafts.set(docId, body);
}

/** The corpus's copy with the live drafts laid over it, or `null` if unknown. */
export function snapshotOf(docId: string): DocSnapshot | null {
  const base = known.get(docId);
  if (base === undefined) return null;
  const title = titleDrafts.get(docId);
  const body = bodyDrafts.get(docId);
  return {
    ...base,
    pristineBody: pristine.get(docId) ?? base.pristineBody,
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
  };
}

export function retainDoc(docId: string): void {
  if (docId === "") return;
  displayed.set(docId, (displayed.get(docId) ?? 0) + 1);
}

/** True when the **last** reader showing this document let go of it. */
export function releaseDoc(docId: string): boolean {
  const count = displayed.get(docId);
  if (count === undefined) return false;
  if (count > 1) {
    displayed.set(docId, count - 1);
    return false;
  }
  displayed.delete(docId);
  return true;
}

export function isDisplayed(docId: string): boolean {
  return displayed.has(docId);
}

export function markAbandoned(docId: string): void {
  abandoned.add(docId);
}

export function unmarkAbandoned(docId: string): void {
  abandoned.delete(docId);
}

/** Claims the deletion; `false` when somebody already has it. */
export function beginDelete(docId: string): boolean {
  if (deleting.has(docId)) return false;
  deleting.add(docId);
  return true;
}

export function endDelete(docId: string): void {
  deleting.delete(docId);
}

export function isAbandoned(docId: string): boolean {
  return abandoned.has(docId);
}

/**
 * Drops what a document nobody is showing no longer needs remembered.
 *
 * **The pristine body deliberately survives.** React's development
 * double-mount releases a reader the instant it takes it, and a `forgetDoc`
 * that cleared the create-time body there would leave the document looking
 * "templated by somebody else" for the rest of its life — which is precisely
 * how the `＋` path silently stopped being abandonable (found in the UI-017
 * drill). It is dropped by {@link forgetPristineBody} when the document is
 * actually gone.
 */
export function forgetDoc(docId: string): void {
  known.delete(docId);
  titleDrafts.delete(docId);
  bodyDrafts.delete(docId);
  abandoned.delete(docId);
  deleting.delete(docId);
}

export function forgetPristineBody(docId: string): void {
  pristine.delete(docId);
}

/**
 * Told when a document has been abandoned, so a host can drop it from its
 * navigation stack in the same tick.
 *
 * Without it, Back would land on a tombstone: the entry naming the removed
 * document is still on the stack that pushed past it (sprint-016 TEST-428).
 */
export function subscribeAbandoned(listener: (docId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceAbandoned(docId: string): void {
  for (const listener of [...listeners]) listener(docId);
}

/** Test seam: the registry is module state and a suite must be able to reset it. */
export function resetAbandonRegistry(): void {
  known.clear();
  pristine.clear();
  titleDrafts.clear();
  bodyDrafts.clear();
  displayed.clear();
  abandoned.clear();
  deleting.clear();
  listeners.clear();
}
