import type { ThreadSummary } from "./CollapsedThread";

/**
 * What a conversation is called where something has to name it — the menu's
 * accessible name, and the `⋯`'s.
 *
 * It sits in its own module so `ThreadMenuTrigger` can read it without importing
 * the panel that renders the trigger. One derivation, so the menu and the button
 * that opens it cannot come to name the same conversation differently.
 */
export function panelMenuLabel(summary: ThreadSummary): string {
  if (summary.quote !== "") return `“${summary.quote}”`;
  return summary.parent === null ? "this standalone thread" : "this whole-document thread";
}

/** `Actions for “lender spreads”` — what the menu and its trigger both announce. */
export function panelMenuTitle(summary: ThreadSummary): string {
  return `Actions for ${panelMenuLabel(summary)}`;
}
