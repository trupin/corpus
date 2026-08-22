/**
 * How a surface asks a reader to open a document — and, optionally, where
 * inside it to land (UI-037, sprint-023 OC5).
 *
 * These types live in the kit rather than in `apps/ui` because they are the
 * vocabulary of an *open*, and every surface that can trigger one speaks it:
 * a board column, a comments tab, an anchored thread, a focus-mode reader.
 * Keeping one spelling of "open this document at this thing" is what stops
 * "open a document" and "point at something inside it" from becoming two
 * mechanisms that drift.
 */

/**
 * Where inside a document an open should land — the **reveal target**.
 *
 * One discriminated field rather than two mechanisms: "open this document at
 * this item" and "open this document at this thread" are the same act with a
 * different destination, and a caller that could only name a document had to
 * choose between opening it and pointing at anything inside it.
 */
export type RevealTarget = RevealItem | RevealThread;

/**
 * A piece of the document's own text, quoted the way SPEC.md §6 quotes an
 * anchor: `exact` is what to find, `prefix`/`suffix` are the surrounding text
 * that says **which** occurrence when the quote is not unique (sprint-023 OC4 —
 * `exact` alone silently reveals the wrong duplicate item).
 *
 * The text is matched against what the reader *rendered*, so it is the
 * document's prose, not its markdown: quote the item, not `- [ ] the item`.
 */
export interface RevealItem {
  readonly kind: "item";
  readonly exact: string;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
}

/** A thread on the document: the reader expands it, scrolls to it and flashes it. */
export interface RevealThread {
  readonly kind: "thread";
  readonly threadId: string;
}

/**
 * An open, with somewhere to land. `reveal` is honoured **once**, when the
 * document has rendered; the reader then forgets it, so Back onto the same
 * entry restores the scroll position the user left rather than re-flashing.
 */
export interface OpenRequest {
  readonly docId: string;
  readonly reveal?: RevealTarget | undefined;
}

/**
 * What every open seam accepts. A bare document id is exactly the request it
 * has always been — the reveal is additive, and a caller that has nothing to
 * reveal keeps passing a string.
 */
export type OpenPayload = string | OpenRequest;
