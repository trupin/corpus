import type { DocFrontmatter } from "@corpus/contract";
import type { Board } from "../board/boardDoc";

/**
 * Which stages a person may set on this document by hand, and under whose name
 * (SPEC.md §10, rider 6 — "anything the graph does not allow is done by setting
 * the field in the document").
 *
 * **Two kanbans over the same documents with different vocabularies is the case
 * this shape exists for.** `stage` is one value on one document (SPEC.md §5), so
 * two boards that both claim a document offer two lists of words for one field —
 * and a flat list of both would say nothing about which board a word came from.
 * They are grouped by board title, exactly as the prototype's `stageMenu` groups
 * them.
 *
 * **A scope this client cannot evaluate counts as matching**, which is the
 * deliberate direction of the error. The board's `query` is the server's
 * grammar, not this file's — a `needs=me` or a `due` scope is decided by the
 * projection — so a client that treated "I do not understand this filter" as "it
 * does not match" would silently hide a board's whole vocabulary from the one
 * control that offers it. Offering a stage that turns out to write no status is
 * recoverable; hiding the only route past a transition graph is not.
 */

/** One board's offer: its title, and the words it draws. */
export interface StageChoiceGroup {
  readonly boardId: string;
  readonly boardTitle: string;
  readonly stages: readonly string[];
}

/** The document as this file needs it: its frontmatter, and the folder it sits in. */
export interface ScopedDoc {
  readonly frontmatter: DocFrontmatter;
  /** Relative to `data/docs/`, no trailing slash — what `folderOf(doc.path)` answers. */
  readonly folder: string;
}

/** The filters this client can honestly evaluate against a document. */
function matchesScope(query: Readonly<Record<string, unknown>> | null, doc: ScopedDoc): boolean {
  for (const [key, raw] of Object.entries(query ?? {})) {
    const values = (Array.isArray(raw) ? raw : [raw]).map(String);
    if (key === "type" && !values.includes(doc.frontmatter.type)) return false;
    if (key === "tag" && !values.some((tag) => doc.frontmatter.tags.includes(tag))) return false;
    if (key === "folder") {
      const matched = values.some((scope) => {
        const trimmed = scope.replace(/\/+$/, "");
        return doc.folder === trimmed || doc.folder.startsWith(`${trimmed}/`);
      });
      if (!matched) return false;
    }
    // Every other key — including `status`, which §5 makes irrelevant here
    // because a kanban's scope includes archived documents — is the server's to
    // decide, and is not read as an exclusion.
  }
  return true;
}

/**
 * The boards whose stages this document may be given, in bar order.
 *
 * Only kanbans over **`stage`**: a kanban over `status` names the three statuses
 * of §5, which the status control beside this one already offers, and listing
 * them here would be two controls writing one field.
 *
 * Archived boards are already off `boards` (the collection's default), which is
 * §5's "a board archived after mapping no longer decides anything".
 */
export function stageChoicesFor(
  boards: readonly Board[],
  doc: ScopedDoc,
): readonly StageChoiceGroup[] {
  const groups: StageChoiceGroup[] = [];
  for (const board of boards) {
    const kanban = board.kanban;
    if (kanban === null || kanban.field !== "stage") continue;
    if (!matchesScope(board.query, doc)) continue;
    groups.push({ boardId: board.id, boardTitle: board.title, stages: kanban.stages });
  }
  return groups;
}

/**
 * Every stage on offer, deduplicated — what the `<select>` accepts.
 *
 * The document's own stage is included even when no board draws it, because the
 * control must be able to show the value it is looking at: a `<select>` whose
 * value is not among its options renders as blank, which would read as "this
 * document has no stage" about a document that has one.
 */
export function offeredStages(
  groups: readonly StageChoiceGroup[],
  current: string | null,
): readonly string[] {
  const seen = new Set<string>();
  for (const group of groups) for (const stage of group.stages) seen.add(stage);
  if (current !== null && current !== "") seen.add(current);
  return [...seen];
}
