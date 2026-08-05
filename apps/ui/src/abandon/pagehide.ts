/**
 * The tab-close sequence, in the one order that is correct.
 *
 * Three surfaces act on `pagehide`: the abandon rule decides whether the open
 * document is removed (`useAbandonEmpty`), autosave sends its buffer
 * (`useAutosave`), and the frontmatter form sends its title draft
 * (`FrontmatterForm`). The **decision has to land first** — it is what the two
 * flushes consult (`isAbandoned`) before writing — and on every other exit route
 * that ordering is a structural guarantee: the abandon decision is taken in the
 * host's *layout*-effect teardown, which React runs ahead of the passive
 * teardowns carrying the flushes (sprint-016 TEST-425).
 *
 * On `pagehide` nothing unmounts, so that guarantee does not apply. Three plain
 * `window.addEventListener` calls fire in **registration** order, which is
 * effect order, which is child-before-parent — the editor's flush registers
 * *before* the host's decision. A `PUT` for a document that is about to be
 * `DELETE`d is then already on the wire, which is the race this module removes:
 * one listener, and the phases run in a declared order rather than in whatever
 * order the tree happened to mount.
 *
 * A third phase joined for the same kind of reason, not for a different one
 * (UI-044). Ending the document's **edit session** (SPEC.md §4) tells the server
 * to emit the acknowledgment *now*, over the commit range as it stands — so it
 * has to be issued after the writes, or the last buffer's `PUT` lands behind the
 * event that was supposed to describe it and opens a second session nobody is
 * left to close. `settle` is that: everything that ends a session, after
 * everything that writes one.
 *
 * It is still deliberately not a general event bus. Three phases, one event,
 * each earning its place with a write ordering — never a priority number.
 */

/** Phases run in order; each runs to completion before the next one starts. */
export type UnloadPhase = "decide" | "flush" | "settle";

const PHASES: readonly UnloadPhase[] = ["decide", "flush", "settle"];

const handlers: Record<UnloadPhase, Set<() => void>> = {
  decide: new Set(),
  flush: new Set(),
  settle: new Set(),
};

let listening = false;

function runSequence(): void {
  for (const phase of PHASES) {
    // Copied, because a handler is allowed to unregister during the sequence —
    // an abandon that pops a navigation stack tears surfaces down as it runs.
    for (const handler of [...handlers[phase]]) handler();
  }
}

function pending(): number {
  return PHASES.reduce((total, phase) => total + handlers[phase].size, 0);
}

/**
 * Registers `handler` for the tab-close sequence; returns its deregistration.
 *
 * The window listener exists only while something is registered, so a test — or
 * a board with no reader open — leaves nothing behind.
 */
export function onPageHide(phase: UnloadPhase, handler: () => void): () => void {
  handlers[phase].add(handler);
  if (!listening) {
    window.addEventListener("pagehide", runSequence);
    listening = true;
  }
  return () => {
    handlers[phase].delete(handler);
    if (listening && pending() === 0) {
      window.removeEventListener("pagehide", runSequence);
      listening = false;
    }
  };
}

/** Test seam: the sequence is module state and a suite must be able to reset it. */
export function resetPageHide(): void {
  for (const phase of PHASES) handlers[phase].clear();
  if (listening) {
    window.removeEventListener("pagehide", runSequence);
    listening = false;
  }
}
