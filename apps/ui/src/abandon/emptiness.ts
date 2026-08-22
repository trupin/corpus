import { UNTITLED_DOCUMENT_TITLE } from "../board/useCreateInColumn";
import { canonicalizeMarkdown } from "../editor/markdown/serialize";

/**
 * What "empty" means, for the one rule that destroys a document (SPEC.md §10):
 * *"a document that is empty — no title and no body content — when you exit it
 * is automatically deleted, whatever the exit route"*.
 *
 * **The conjunction is the whole rule.** A title alone is a document; a body
 * alone is a document. Only the absence of both is emptiness, and an
 * implementation that treated either alone as empty would delete work the user
 * did (sprint-016 TEST-419).
 *
 * **History does not matter, only the state at exit.** That is the sentence the
 * user wrote the rule for — start typing, change your mind, remove what you
 * wrote, leave — so nothing here remembers what a document once held.
 *
 * **A template's skeleton is not content the user wrote.** SPEC.md §10's
 * "Templates are documents" means a new `note` in a seeded workspace is born
 * holding `## Context / ## Notes / ## Open questions` — so a rule that only
 * asked "is the body blank?" would exempt the `＋` path from the whole issue in
 * exactly the workspaces that ship templates, which is every workspace `corpus
 * init` creates. A document still holding the body it was **born** with is
 * therefore as empty as one holding nothing (found by the real-app drill, not
 * by a unit test — jsdom has no templates).
 */

/**
 * The `＋` placeholder is **not** a title (sprint-016 Adjudication 16).
 *
 * A user who typed nothing has titled nothing, and counting the placeholder
 * would exempt the column-`＋` path from the entire rule — which is the exact
 * annoyance the rule was filed for.
 */
export function isBlankTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === UNTITLED_DOCUMENT_TITLE;
}

/**
 * A line the editor can leave behind that carries no text of its own: a heading
 * marker the user typed and abandoned, an empty bullet, an empty quote.
 *
 * ProseMirror's document is never truly empty, so the test has to be against
 * the **serialized markdown** the `PUT` would carry — which is what every
 * caller here passes.
 */
const EMPTY_MARKER = /^(?:#{1,6}|[-*+>]|\d+[.)])$/;

export function isBlankBody(body: string): boolean {
  return body.split("\n").every((line) => {
    const trimmed = line.trim();
    return trimmed === "" || EMPTY_MARKER.test(trimmed);
  });
}

/**
 * The two types whose body is **not** where their content lives, and which the
 * rule therefore never applies to.
 *
 * A `thread` is its conversation (SPEC.md §6) and a `view` is its stored query
 * (SPEC.md §10) — both are routinely "empty" in the body sense while being
 * entirely full of what the user made. `DocEditor` draws the same line for the
 * same reason.
 */
const NON_ABANDONABLE_TYPES = new Set(["thread", "view"]);

export interface DocSnapshot {
  readonly type: string;
  readonly title: string;
  /** The serialized markdown body — the editor's live one when it has one. */
  readonly body: string;
  /** Threads **on** this document. */
  readonly threadCount: number;
  /**
   * The body the document was created with — a template's prefill, or `""` —
   * or `null` when this session did not create it and cannot know.
   */
  readonly pristineBody: string | null;
  /**
   * True when the document carries frontmatter the core does not define
   * (`extra`).
   *
   * `extra` is **opaque passthrough the core never interprets** (SPEC.md §9's
   * `extra_json`), so a blank body is not evidence about a document that has
   * any: whatever is in there is content this rule cannot read, and deleting
   * the document would destroy it unseen. Asking the *document* rather than
   * asking what wrote those keys is what keeps the guard true when nothing in
   * this build recognises them, which is precisely when nothing else would
   * notice.
   */
  readonly hasExtra: boolean;
}

/**
 * Whether leaving this document should remove it.
 *
 * The two guards beyond emptiness are both about *not* destroying something the
 * user made:
 *
 * - a document that acquired a **thread** persists (sprint-016 Adjudication 18)
 *   — a thread is content the user deliberately created about this document,
 *   and removing the document would orphan it, which the same spec sentence
 *   forbids;
 * - a document carrying frontmatter the core does not define persists, because
 *   the core cannot read what is in `extra` and must not delete it unseen.
 */
export function isAbandonable(snapshot: DocSnapshot): boolean {
  if (NON_ABANDONABLE_TYPES.has(snapshot.type)) return false;
  if (snapshot.threadCount > 0) return false;
  if (snapshot.hasExtra) return false;
  return isBlankTitle(snapshot.title) && !hasWrittenBody(snapshot);
}

/**
 * Whether the body holds anything the **user** put there.
 *
 * Both comparisons go through the editor's own canonicalisation, because the
 * two strings come from different places: the pristine body is the file as the
 * server wrote it, and the live one is TipTap's serialisation of the same
 * markdown. Comparing them raw would call an untouched template "changed" the
 * first time the editor round-tripped it.
 */
function hasWrittenBody(snapshot: DocSnapshot): boolean {
  if (isBlankBody(snapshot.body)) return false;
  const { pristineBody } = snapshot;
  if (pristineBody === null) return true;
  return canonicalizeMarkdown(snapshot.body) !== canonicalizeMarkdown(pristineBody);
}
