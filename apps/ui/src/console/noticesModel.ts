import type { ToastTone } from "../shell/Toasts";

/**
 * The words the console's **Notices** tab says — every warning and refusal this
 * session raised, after its toast has gone (SPEC.md §11's Notices paragraph,
 * rider authorized 2026-08-21; UI-139).
 *
 * Pure and apart from the component, for `residentsModel`'s reason: the honesty
 * is in the wording, and wording derived inside a component is wording no test
 * reaches without rendering one.
 *
 * ## Why this tab exists at all
 *
 * A toast is clamped to two lines so the stack cannot move (UI-132), and it
 * reveals what it cut on a `title`. A `title` on a non-focusable `<span>`
 * produces no tooltip on focus in any browser and there is no hover on touch,
 * so that reveal reaches a sighted pointer user and nobody else. A refusal's
 * reason is a server string of no bounded length that exists on no other
 * surface, so for a keyboard-only or touch user it was a message that could not
 * be finished. This tab is the reveal that needs no pointer: it shows the text
 * **whole**, which is why nothing here clamps and why the row's height is
 * allowed to be its text — a second clamp with no reveal would reintroduce the
 * defect one surface further in.
 */

/** The tab's own name, in the console's tab strip. */
export const NOTICES_TAB_LABEL = "Notices";

/** The scrolling list's accessible name. */
export const NOTICES_LIST_LABEL = "Notices";

/**
 * The empty state, which says what the tab is *and* what it costs.
 *
 * "A reload clears them" is not an apology — it is the rider's stated cost of a
 * record that needs no server, and a person who is told it can copy a refusal
 * out before refreshing. Saying nothing would have let the list read as durable.
 */
export const NO_NOTICES_NOTE =
  "Nothing raised this session. Warnings and refusals land here as they arrive, " +
  "and a reload clears them.";

/** The strip marker's tooltip — the only words the marker itself has. */
export const NOTICES_UNREAD_HINT = "An error notice you have not read — open the console's Notices";

/**
 * What the bound says when it bites. §11 forbids a listing that ends quietly:
 * *"on reaching its bound the oldest go and it says so"*.
 *
 * `cap` is passed rather than imported so that this stays a pure sentence with
 * no opinion about how many are kept. The one render site passes `MAX_NOTICES`,
 * which is the store's own bound, so the number in the sentence cannot drift
 * from the number enforced.
 */
export function droppedNoticesLine(dropped: number, cap: number): string {
  const plural = dropped === 1 ? "notice" : "notices";
  return `${String(dropped)} earlier ${plural} dropped — this list keeps the newest ${String(cap)}.`;
}

/**
 * When it arrived, as `HH:MM:SS` in the reader's own clock.
 *
 * Built from the date's parts rather than `toLocaleTimeString`, for two
 * reasons. The width is fixed, so a notice arriving at 09:05 and one at 14:32
 * occupy the same box — §11's rider again, at row grain. And it is the same
 * eight characters in every locale, so the column reserved for it in
 * `console.css` is a measurement rather than a guess.
 *
 * Wall-clock time, not "3m ago": a relative label needs a clock ticking behind
 * it, and the one thing a session log must never do is change what it says
 * about an entry after the entry is written.
 */
export function noticeTimeLabel(at: number): string {
  const when = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
}

/**
 * The tone, in a word.
 *
 * The toast's own vocabulary and no other: an error toast is raised for a
 * refused write and for a warning alike, so calling it "refused" here would be
 * a claim the raise did not make.
 */
export function noticeToneLabel(tone: ToastTone): string {
  return tone === "error" ? "error" : "info";
}
