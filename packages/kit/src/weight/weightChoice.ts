/**
 * The weight a composer is currently stating, and the per-conversation starting
 * point it comes back to (SPEC.md §11, rider SHARED-022 signed 2026-08-06).
 *
 * ## Three rules, and each has a plausible-looking wrong implementation
 *
 * **Nothing is preselected.** "Choosing nothing is the ordinary case and means
 * the agent decides — the control has no preselected level, and a composer that
 * has never been touched behaves exactly as it does today." So the unset state
 * is modelled as **absence**: no entry in the map, `undefined` out of the hook,
 * and {@link ComposerWeight.request} is `{}` rather than `{ weight: null }`.
 * That absence survives every hop — the contract's field is `.optional()` with
 * no `.default()` and rejects `""` with a `400`, so a picker nobody touched
 * *cannot* accidentally state something. A `<select>` defaulted to "Standard"
 * because an element needs a value has deleted the feature's premise, and
 * SHARED-022's non-goals say so by name.
 *
 * **The starting point is browser-local and dies with the page.** §11 puts it in
 * the same class as reader width and collapse state — "only browser-local state
 * stays local" — and Decision 3 rejects a per-thread value written to the thread
 * document *by name*. So it is a module-level map and **not** `localStorage`:
 * reload clears it, a second browser never sees it, and no thread or document
 * gains a field. (`threadCollapse.ts` persists because a fold is a reading
 * posture that should outlive a reload; a stated weight is about the request you
 * are about to send, and §11 asks for a starting point "in the same
 * conversation", not a setting.)
 *
 * **One value per conversation, shared by every surface showing it.** Two
 * columns showing the same thread show the same standing choice, exactly as
 * collapse state does — which falls out of keying by scope rather than by
 * component. The scopes are built by {@link threadWeightScope} and
 * {@link docWeightScope}; see them for what counts as a conversation.
 *
 * ## What this is not
 *
 * It is not a setting and it is not sticky beyond its scope: the value is
 * visible on the control the moment a composer opens, and changeable in one
 * gesture. §11's words are "as a visible starting point that can be changed in
 * one gesture, never as a setting that acts on you unseen" — the visibility is
 * what makes remembering it legitimate, so a surface that stores a choice must
 * render it.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWeightLevels } from "./useWeightLevels.js";
import type { WeightLevel } from "./weightLevels.js";

/** The standing choice per scope. Absent key ⇒ nothing chosen. */
const choices = new Map<string, string>();

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of [...listeners]) listener();
}

/** The key that travels for this scope, or `undefined` when nothing is chosen. */
export function weightChoice(scope: string): string | undefined {
  return choices.get(scope);
}

/**
 * States a choice for one conversation, or clears it.
 *
 * Written on **selection** rather than on send, because the value is what the
 * control displays and §11 requires two surfaces on one conversation to agree.
 * Sending changes nothing here: the request carried the value, and the same
 * value is the next request's starting point.
 */
export function chooseWeight(scope: string, key: string | undefined): void {
  const current = choices.get(scope);
  if (current === key) return;
  if (key === undefined) choices.delete(scope);
  else choices.set(scope, key);
  announce();
}

export function subscribeWeightChoices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Forgets every standing choice.
 *
 * For the jsdom suites' `afterEach`: a choice outlives a component by design, so
 * without this one test's click is the next test's starting state. Nothing in
 * the app calls it — a reload is how a person clears these, and §11 describes no
 * "forget my weights" action.
 *
 * **Reachable only through `@corpus/kit/testing`** (UI-082's PR #35 review), never through the
 * package root. It was on the plugin surface until a review pointed out what
 * that publishes: an action §11 does not describe, offered to plugin authors as
 * though it were one, and callable from a plugin to wipe every composer's
 * standing choice out from under the person who made them. The test-support
 * subpath is where a helper whose own docblock says "for the suites" belongs.
 */
export function resetWeightChoices(): void {
  if (choices.size === 0) return;
  choices.clear();
  announce();
}

/**
 * The scope of a thread's **reply box** — the composer that continues it.
 *
 * "The same conversation" is the thread, so two columns showing it share one
 * starting point. The comment-on-a-turn box sitting inside one of its turns
 * does **not** share it — that box always sends `requestsAgent: false`, so it
 * sits on §11's floor and offers no weight at all (UI-126); a scope for a
 * choice that cannot be made would be a value nothing renders, which is the
 * "acts on you unseen" case §11 forbids. Its `child:` scope was removed with
 * its control.
 */
export function threadWeightScope(threadId: string): string {
  return `thread:${threadId}`;
}

/**
 * The scope of a comment on a document selection.
 *
 * A new comment is not yet in a conversation, so the nearest thing §11's rule
 * can mean is the document being commented on: comment twice on the same
 * document and the second composer starts from the first's choice, which is the
 * behaviour the rule exists to produce.
 */
export function docWeightScope(docId: string): string {
  return `doc:${docId}`;
}

/**
 * The scope of the global composer — **Ask and Capture together**.
 *
 * SHARED-022 genuinely does not say, because the global composer's Ask is not a
 * conversation: every Ask starts a new one. Two readings were available and this
 * is the one taken (UI-082, reported to the orchestrator):
 *
 *   - **Taken — one scope for the overlay, for this browser session.** The
 *     composer is a single surface with two submits, so it keeps one starting
 *     point across both. It is *visible* the instant the overlay opens and
 *     clearable in one gesture, so it is a starting point rather than a setting
 *     acting on anyone unseen, and it dies with the page like every other
 *     browser-local value here.
 *   - **Rejected — no memory at all.** Defensible on the letter ("the same
 *     conversation" never applies), but it makes the one composer people open
 *     most the only one that forgets, and re-picking on every Ask is exactly the
 *     friction the rule removes elsewhere.
 */
export const GLOBAL_COMPOSE_WEIGHT_SCOPE = "compose:global";

/** What a composer needs to offer the control and to build its request. */
export interface ComposerWeight {
  /**
   * The levels this workspace declares, lightest first. **Empty means no
   * control at all** — never a fallback list.
   */
  readonly levels: readonly WeightLevel[];
  /** The chosen key, or `undefined` for the ordinary "the agent decides". */
  readonly chosen: string | undefined;
  /**
   * Ready to spread onto a request body: `{}` when nothing is chosen.
   *
   * The single spelling of absence, in one place, so no surface can invent a
   * second one — a `null` or an empty string here is a `400` at the contract
   * boundary, deliberately.
   */
  readonly request: { readonly weight?: string };
  /** States a level, or clears it. Passing the chosen key again clears it. */
  readonly choose: (key: string | undefined) => void;
}

/**
 * One composer's weight: what it may offer, what it is stating, and what to send.
 *
 * **A choice cannot outlive the control that made it.** When the declaration
 * yields no levels the request states nothing, whatever is standing in the map —
 * otherwise editing the guidance to declare nothing would leave a composer
 * silently sending a weight it no longer shows, which is the "acts on you
 * unseen" case §11 forbids. A level that disappears while others remain is a
 * different matter and is *not* rewritten: the composer's address control keeps showing it
 * so the person can see what will be sent, because the UI silently substituting
 * a surviving level would be the composer lying about the request.
 */
export function useComposerWeight(scope: string): ComposerWeight {
  const levels = useWeightLevels();
  const stored = useSyncExternalStore(
    subscribeWeightChoices,
    () => weightChoice(scope),
    () => undefined,
  );
  const chosen = levels.length === 0 ? undefined : stored;

  const choose = useCallback(
    (key: string | undefined) => {
      chooseWeight(scope, key);
    },
    [scope],
  );

  return useMemo(
    () => ({
      levels,
      chosen,
      request: chosen === undefined ? {} : { weight: chosen },
      choose,
    }),
    [chosen, choose, levels],
  );
}
