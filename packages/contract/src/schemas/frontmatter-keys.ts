/**
 * **Two frontmatter key classes, declared once** (CONTRACT-098, sprint-024 S1).
 *
 * Both classes answer one question — *is a difference in this key a difference
 * in the document?* — for two callers that must not answer it separately: the
 * server, deciding whether a save moves `updated` (SPEC.md §5), and the CLI's
 * template comparison, deciding whether a workspace file has been edited away
 * from the template it was installed from (SPEC.md §2.4). A key restated on
 * each side is two answers waiting to disagree, and the disagreement is
 * invisible: both sides keep working, and one of them is quietly wrong about a
 * file.
 *
 * The two classes are **kept apart rather than merged into one ignore-list**,
 * because a reader has to be able to tell which list a key is on and why. A
 * server-stamped key is one the *server* writes from its own clock. A
 * presentation key is one about *how a document is shown*. A consumer that
 * ignores both unions them at its own call site: a union is derived, and a
 * third declaration is exactly what this module exists to prevent.
 *
 * Neither class is a wire shape, so neither is a Zod schema and neither reaches
 * `openapi.json`. They are vocabulary — the same kind of published fact as
 * {@link RESERVED_FRONTMATTER_KEYS} and `UNSETTABLE_EXCLUSIONS`, and exported
 * here for the same reason those are: the server and the CLI both need them,
 * and `apps/cli` cannot import from `apps/server`.
 */

/**
 * **Server-stamped keys — the server's record of *when* it wrote the file,
 * never a value an author chose.**
 *
 * Membership rule: the server writes the value from its own clock, and no
 * request may set it. `created` is stamped once, at creation, and `unset`
 * refuses to remove it (`UNSETTABLE_EXCLUSIONS`). `updated` is re-stamped by
 * every write the server judges a content edit — which is why it is the key
 * this class was filed for: §5 runs the staleness ramp off
 * `max(updated, reviewed)` and §9.2 orders every default result set
 * newest-updated first, so `updated` moves for reasons that have nothing to do
 * with a person editing anything.
 *
 * Neither key appears on `CreateDocRequestSchema` or `UpdateDocRequestSchema`,
 * which is what makes "not authored" checkable rather than a matter of taste.
 *
 * **The near misses, named so the next key does not have to be argued from
 * scratch.** `reviewed` is a timestamp and is pointedly not here: a person sets
 * it by marking a document still current, it travels on the update request, and
 * its value is an authored act. `anchors`, `origin` and `turnModels` are
 * server-maintained but are not stamps — they record *what* the server did, not
 * *when*, and a difference in one of them is a real difference in the document.
 * `id` and `type` are identity and behaviour, not a record of a write.
 *
 * **What a consumer does with this.** Two copies of one document that differ
 * only in these keys are the same document, so a comparison between copies
 * ignores them. The rule that must travel with ignoring a key — an ignored key
 * present in a workspace copy has to survive the write that ignoring it enabled
 * — belongs to the consumer that performs the write, not to this declaration.
 */
export const SERVER_STAMPED_FRONTMATTER_KEYS = ["created", "updated"] as const;

/**
 * **Presentation keys — how a document is *shown*, never what it holds.**
 *
 * Membership rule: a key belongs here when changing it changes no answer to any
 * question *about* the document — not what it says, not what is being asked of
 * it, not where it sits in the corpus. `width` is the whole class today (§10:
 * "The chosen width lives in the view document's frontmatter"), and one member
 * is the honest count rather than a placeholder: `status`, `tags`, `due`,
 * `stage`, a board's `columns` and a view's `query` all change such an answer,
 * and a title change plainly does. If the class stays a singleton it costs one
 * set lookup, and if a second view-state field is ever written to a document it
 * has a named home instead of a second special case.
 *
 * These are **extra** frontmatter keys, not core ones — `width` is absent from
 * {@link RESERVED_FRONTMATTER_KEYS}, and the board writes it as
 * `PUT { extra: { width } }` (`apps/ui/src/board/useColumnWidth.ts`). That is
 * the one structural difference from the stamped class, whose members are all
 * core keys, and it is why the two lists cannot be checked by one rule.
 *
 * **What the server does with this.** A write of only these keys is not a
 * content edit, so it does not stamp `updated` (SERVER-096). Dragging a board
 * column wider used to put that view document at the head of every list, ahead
 * of documents someone had written in.
 *
 * **What the CLI does with this.** A workspace copy that differs from its
 * template only in these keys has not been edited, so the template comparison
 * ignores them (SPEC.md §2.4) — a resized column is not a customization anyone
 * needs to be told about at every upgrade.
 *
 * Deliberately **not** SERVER-095's line, which is `body || title` and decides
 * whether the agent is woken to reflect. That line is drawn at what the
 * document *says*, because only prose ripples into other documents. This one is
 * drawn at what the document *is*. They are neighbours and they differ:
 * renaming a document, moving it, tagging it or resolving it all move `updated`
 * while only the rename reflects — and both agree that a column's width is
 * neither.
 */
export const PRESENTATION_FRONTMATTER_KEYS = ["width"] as const;

/** A key the server stamps from its own clock. */
export type ServerStampedFrontmatterKey = (typeof SERVER_STAMPED_FRONTMATTER_KEYS)[number];

/** A key about how a document is shown. */
export type PresentationFrontmatterKey = (typeof PRESENTATION_FRONTMATTER_KEYS)[number];

const SERVER_STAMPED_KEY_SET: ReadonlySet<string> = new Set(SERVER_STAMPED_FRONTMATTER_KEYS);
const PRESENTATION_KEY_SET: ReadonlySet<string> = new Set(PRESENTATION_FRONTMATTER_KEYS);

/**
 * Whether `key` is in {@link SERVER_STAMPED_FRONTMATTER_KEYS}. The membership
 * test is exported beside the list so no consumer builds a second `Set` from
 * it — a derived lookup structure is where a filtered or extended copy starts.
 */
export const isServerStampedFrontmatterKey = (key: string): boolean =>
  SERVER_STAMPED_KEY_SET.has(key);

/** Whether `key` is in {@link PRESENTATION_FRONTMATTER_KEYS}. */
export const isPresentationFrontmatterKey = (key: string): boolean => PRESENTATION_KEY_SET.has(key);
