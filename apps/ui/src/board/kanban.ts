import type { Board, KanbanSpec } from "./boardDoc";
import {
  compileQuery,
  folderOfFilter,
  readStoredQuery,
  sortLabelOf,
  type BoardColumn,
  type ColumnChip,
} from "./viewDoc";

/**
 * A kanban board, read (SPEC.md §10, rider 6 — "a kanban is a board over one
 * field").
 *
 * Everything here is pure and takes the board document as its only input,
 * because a kanban's columns are **derived** rather than resolved: there is no
 * view document to fetch, so the whole column set is a function of the file the
 * bar already holds. That is what makes the graph rules testable without a
 * server, and it is why the drag, the head chips and the column menu all read
 * one shape ({@link BoardColumn.stage}) instead of each re-deriving it.
 *
 * **The one rule this file owns alone.** The server enforces the status map and
 * **never** the transitions (SPEC.md §10, and SERVER-138 accepts a stage off the
 * graph with a `200`). So the restriction a drag obeys exists exactly here: if
 * {@link canMove} answers wrongly, nothing downstream catches it.
 */

/** How a kanban's columns are drawn when the file names no transitions. */
export const FUNNEL_HINT = "a drag moves one stage left or right";

/** …and when it does. */
export const GRAPH_HINT = "a drag follows the board’s transitions";

/**
 * The stages a **drag** from `stage` may reach (SPEC.md §10, rider 6).
 *
 * **Absent is not empty, and the difference ships a board that works or one
 * that does not** (AGENT-042's seed kanban carries no `transitions` at all).
 * `transitions` omitted is the *linear funnel* — each stage leads to its
 * neighbours, both ways. `transitions: {}` is a graph nothing may be dragged
 * along, which is a thing a board may legitimately say and is deliberately not
 * the same answer.
 *
 * A target the board does not declare is dropped rather than returned: the
 * contract refuses such a transition on write (`KanbanSchema`), so one in a file
 * is a hand edit, and a drag cannot reach a column that does not exist anyway.
 */
export function leadsTo(kanban: KanbanSpec, stage: string): readonly string[] {
  const transitions = kanban.transitions;
  if (transitions !== undefined) {
    return (transitions[stage] ?? []).filter(
      (target) => target !== stage && kanban.stages.includes(target),
    );
  }
  const at = kanban.stages.indexOf(stage);
  if (at < 0) return [];
  return [kanban.stages[at + 1], kanban.stages[at - 1]].filter(
    (target): target is string => target !== undefined,
  );
}

/**
 * Whether a drag from `from` may be dropped on `to`.
 *
 * A drop on the column a document is already in is not a move and is not a
 * refusal: it changes nothing, so it is neither offered nor complained about
 * (see the drag's own handling).
 */
export function canMove(kanban: KanbanSpec, from: string, to: string): boolean {
  return from !== to && leadsTo(kanban, from).includes(to);
}

/** What a refused drop says, in the prototype's words. */
export function refusalMessage(kanban: KanbanSpec, from: string, to: string): string {
  return (
    `“${from}” does not lead to “${to}” on this board. ` +
    `Set ${kanban.field} in the document to override, or add the transition to the board.`
  );
}

/**
 * The transition graph as one editable line: `a > b, c; b > d`.
 *
 * Blank for a board carrying no `transitions`, which is what the field means:
 * blank is the funnel, and a line that spelled the funnel out would turn an
 * absent key into an explicit one the moment somebody opened the editor.
 */
export function edgesToText(kanban: KanbanSpec): string {
  const transitions = kanban.transitions;
  if (transitions === undefined) return "";
  return kanban.stages
    .map((stage) => `${stage} > ${(transitions[stage] ?? []).join(", ")}`)
    .join("; ");
}

/**
 * That line, parsed back against the stages the board declares.
 *
 * Every declared stage gets a key, so a stage the line does not mention is a
 * stage nothing leads out of rather than one that falls back to the funnel — the
 * whole point of writing the map down. Anything naming a stage the board does
 * not declare is dropped: the contract would refuse it, and a `400` from a typo
 * in a comma-separated field is a worse answer than ignoring the word.
 */
export function textToEdges(text: string, stages: readonly string[]): Record<string, string[]> {
  const edges: Record<string, string[]> = {};
  for (const stage of stages) edges[stage] = [];
  for (const part of text.split(";")) {
    const halves = part.split(">");
    if (halves.length !== 2) continue;
    const from = (halves[0] ?? "").trim();
    if (!Object.hasOwn(edges, from)) continue;
    edges[from] = (halves[1] ?? "")
      .split(",")
      .map((target) => target.trim())
      .filter((target) => target !== from && stages.includes(target));
  }
  return edges;
}

/** `candidates, visiting, offer` ⇄ the stage list, blanks and repeats dropped. */
export function textToStages(text: string): string[] {
  const stages: string[] = [];
  for (const part of text.split(",")) {
    const stage = part.trim();
    if (stage === "" || stages.includes(stage)) continue;
    stages.push(stage);
  }
  return stages;
}

/**
 * A board's scope, as the prototype's one-line form takes it: `folder:<path>`,
 * `tag:<tag>`, `type:<type>`, or blank for everything.
 *
 * Deliberately three keys and not the whole query grammar: this is the creation
 * dialog's field, and the board document is where an arbitrary query is written.
 * A line naming anything else compiles to the empty scope rather than to an
 * error, which is the same "everything" a blank line means.
 */
export function textToScope(text: string): Record<string, string> {
  const match = /^(folder|tag|type):\s*(.+)$/.exec(text.trim());
  if (match === null) return {};
  return { [match[1] ?? ""]: (match[2] ?? "").trim() };
}

/** That scope back as the line, so the dialog can be re-opened on a board. */
export function scopeToText(query: Readonly<Record<string, unknown>> | null): string {
  for (const key of ["folder", "tag", "type"]) {
    const value = (query ?? {})[key];
    if (typeof value === "string" && value !== "") return `${key}:${value}`;
  }
  return "";
}

/** `kanban.stages` with the stage at `from` moved to `to`, or unchanged. */
export function moveStage(stages: readonly string[], from: number, to: number): readonly string[] {
  if (from < 0 || from >= stages.length || to < 0 || to >= stages.length || from === to) {
    return stages;
  }
  const rest = stages.filter((_, index) => index !== from);
  const moved = stages[from];
  if (moved === undefined) return stages;
  return [...rest.slice(0, to), moved, ...rest.slice(to)];
}

/**
 * One derived column's id: `<boardId>#<stage>`.
 *
 * Stable across renders and across a board's own edits, which is what lets the
 * browser-local state hanging off a column — its scroll position, its in-place
 * reader, the paths that grew out of its rows — survive a stage being renamed
 * somewhere else in the list.
 */
export function stageColumnId(boardId: string, stage: string): string {
  return `${boardId}#${stage}`;
}

/**
 * The chips a stage column's head draws, in the prototype's order: the scope's
 * own filters, this column's `field: value`, "or no stage" on the first, the
 * `→ <status>` a mapped stage writes, then the outgoing edges.
 */
function stageChips(
  scopeChips: readonly ColumnChip[],
  kanban: KanbanSpec,
  stage: string,
  holdsUnset: boolean,
  mapped: string | null,
  edges: readonly string[],
): ColumnChip[] {
  const chips: ColumnChip[] = [
    ...scopeChips,
    { key: kanban.field, label: `${kanban.field}: ${stage}` },
  ];
  if (holdsUnset) {
    chips.push({
      key: "unset",
      label: "or no stage",
      tone: "muted",
      title: "A document with no stage yet sits in the first column",
    });
  }
  if (mapped !== null) {
    chips.push({
      key: "mapped",
      label: `→ ${mapped}`,
      tone: "good",
      title: "Entering this stage writes this status",
    });
  }
  if (edges.length === 0) {
    chips.push({
      key: "edge-end",
      label: "→ ∅",
      tone: "edge-end",
      title: "Nothing leads out of this stage by drag",
    });
    return chips;
  }
  for (const target of edges) {
    chips.push({
      key: `edge:${target}`,
      label: `→ ${target}`,
      tone: "edge",
      title: "Where a drag from this column may go",
    });
  }
  return chips;
}

/**
 * One kanban board's columns — one per stage, in `kanban.stages` order
 * (SPEC.md §10, rider 6).
 *
 * **The first column is one request, not two ORed here.** §10 puts a document in
 * scope with no value for the field in the first column *beside* the documents
 * actually in the first stage, and `GET /api/docs?stage=,<first>`'s empty
 * element is the null sentinel that makes that union a single query
 * (CONTRACT-074). A kanban over `status` needs none of it: every document has a
 * status.
 *
 * **A stage mapped to `archived` shows archived documents**, which every other
 * column hides by default — otherwise the coupling of §5 would move a card into
 * a column and out of sight in the same commit. The board's own scope wins if it
 * already names a `status`: that is the board author's filter, and adding a
 * second here would silently overrule the file.
 *
 * `viewId` is the **board** document, because that is the file every act on one
 * of these columns edits — its width, its stages, its transitions.
 */
export function deriveStageColumns(board: Board): readonly BoardColumn[] {
  const kanban = board.kanban;
  if (kanban === null) return [];
  const { stored, error: queryError } = readStoredQuery(board.query);
  const scope = compileQuery(stored);
  const folder = folderOfFilter(scope.filter);
  const lastIndex = kanban.stages.length - 1;

  return kanban.stages.map((stage, index) => {
    const holdsUnset = kanban.field === "stage" && index === 0;
    const mapped = kanban.status?.[stage] ?? null;
    const edges = leadsTo(kanban, stage);
    const filter: Record<string, string> = { ...scope.filter };
    filter[kanban.field] = holdsUnset ? `,${stage}` : stage;
    if (kanban.field === "stage" && mapped === "archived" && scope.filter["status"] === undefined) {
      filter["status"] = "archived";
    }

    return {
      id: stageColumnId(board.id, stage),
      viewId: board.id,
      title: stage,
      kind: "stage",
      filter,
      storedQuery: stored,
      chips: stageChips(scope.chips, kanban, stage, holdsUnset, mapped, edges),
      sortLabel: sortLabelOf(filter),
      folder,
      width: board.width,
      error: queryError ?? scope.error,
      missing: false,
      stage: {
        boardId: board.id,
        field: kanban.field,
        stage,
        index,
        lastIndex,
        holdsUnset,
        mapped,
        leadsTo: edges,
      },
    } satisfies BoardColumn;
  });
}
