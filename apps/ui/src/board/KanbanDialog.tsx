import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { edgesToText, textToEdges, textToScope, textToStages } from "./kanban";
import type { KanbanSpec } from "./boardDoc";

/**
 * The kanban form: a small dialog, never `window.prompt`.
 *
 * The prototype asks its four questions with four `prompt()` calls
 * (`design/navigation.html`'s `newBoard("kanban")`), which is a prototype's
 * shorthand: a modal chain nothing can cancel halfway, no field is visible
 * beside another, and nothing can be corrected once answered. The questions and
 * their wording are kept exactly; the shape is a form.
 *
 * **Three uses, one form.** Creating a kanban asks all four; the stage column's
 * ⋯ re-opens the same dialog on one field — the stages, or the transitions —
 * because both edits are the same edit to `kanban.stages` and `kanban.transitions`
 * and a second form for each is a second set of parsing rules.
 *
 * **Blank means the funnel, and it must keep meaning it.** A transitions line
 * left empty writes **no** `transitions` key at all, which SPEC.md §10 defines
 * as "each stage leads to its neighbours, both ways". Writing `{}` instead would
 * be a graph nothing can be dragged along — the same keystroke, the opposite
 * board.
 */

export type KanbanDialogMode = "create" | "stages" | "transitions";

export interface KanbanDialogSubmit {
  readonly title: string;
  readonly kanban: KanbanSpec;
  /** Only meaningful when creating: an existing board's scope is its own. */
  readonly query: Readonly<Record<string, string>>;
}

export interface KanbanDialogProps {
  readonly mode: KanbanDialogMode;
  /** The board being edited, or `null` when one is being created. */
  readonly kanban: KanbanSpec | null;
  readonly onSubmit: (result: KanbanDialogSubmit) => void;
  readonly onClose: () => void;
}

const TITLES: Readonly<Record<KanbanDialogMode, string>> = {
  create: "New kanban board",
  stages: "Edit the stages",
  transitions: "Edit the transitions",
};

/** The field a mode opens focused — the one it exists to change. */
const FOCUS_FIELD: Readonly<Record<KanbanDialogMode, string>> = {
  create: "kanban-title",
  stages: "kanban-stages",
  transitions: "kanban-transitions",
};

export function KanbanDialog({ mode, kanban, onSubmit, onClose }: KanbanDialogProps): ReactElement {
  const [title, setTitle] = useState("");
  const [stages, setStages] = useState(kanban?.stages.join(", ") ?? "gather, file, paid");
  const [transitions, setTransitions] = useState(kanban === null ? "" : edgesToText(kanban));
  const [scope, setScope] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const dialog = useRef<HTMLFormElement>(null);

  useEscapeLayer({
    active: true,
    priority: EscapeLayerPriority.Overlay,
    onEscape: onClose,
  });

  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>(`#${FOCUS_FIELD[mode]}`)?.focus();
  }, [mode]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const parsedStages = textToStages(stages);
    if (parsedStages.length === 0) {
      setProblem("A kanban needs at least one stage — its stages are its columns.");
      return;
    }
    const parsedTitle = title.trim();
    if (mode === "create" && parsedTitle === "") {
      setProblem("A board needs a title — it is what the tab says.");
      return;
    }
    const edges = transitions.trim();
    /*
     * The status map, narrowed to the stages that survive. The contract refuses
     * a `kanban.status` key that is not one of `stages` (`KanbanSchema`), so a
     * stage removed here would otherwise make the very next save a `400` — the
     * edit refused for a key the person never touched.
     */
    const kept = Object.entries(kanban?.status ?? {}).filter(([stage]) =>
      parsedStages.includes(stage),
    );
    onSubmit({
      title: parsedTitle,
      kanban: {
        // Editing an existing board never changes the field it is drawn over:
        // that would repoint every column at another frontmatter key and leave
        // every document where it was.
        field: kanban?.field ?? "stage",
        stages: parsedStages,
        ...(edges === "" ? {} : { transitions: textToEdges(edges, parsedStages) }),
        ...(kept.length === 0 ? {} : { status: Object.fromEntries(kept) }),
      },
      query: textToScope(scope),
    });
  };

  return (
    <div className="kanban-dialog-backdrop" role="presentation">
      <form
        ref={dialog}
        className="kanban-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[mode]}
        onSubmit={submit}
      >
        <h2>{TITLES[mode]}</h2>

        {mode !== "create" ? null : (
          <label className="kanban-field" htmlFor="kanban-title">
            <span>Board title</span>
            <input
              id="kanban-title"
              value={title}
              placeholder="Tax season"
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </label>
        )}

        {mode === "transitions" ? null : (
          <label className="kanban-field" htmlFor="kanban-stages">
            <span>Stages, in funnel order, comma-separated</span>
            <input
              id="kanban-stages"
              value={stages}
              placeholder="gather, file, paid"
              onChange={(event) => {
                setStages(event.target.value);
              }}
            />
          </label>
        )}

        {mode === "stages" ? null : (
          <label className="kanban-field" htmlFor="kanban-transitions">
            <span>Transitions — blank for a linear funnel</span>
            <input
              id="kanban-transitions"
              value={transitions}
              placeholder="from &gt; to, to; from &gt; to"
              onChange={(event) => {
                setTransitions(event.target.value);
              }}
            />
            <span className="kanban-hint">
              Blank leaves the key out, which is the linear funnel: each stage leads to its
              neighbours, both ways. A stage named with nothing after <code>&gt;</code> is a stage
              nothing leads out of.
            </span>
          </label>
        )}

        {mode !== "create" ? null : (
          <label className="kanban-field" htmlFor="kanban-scope">
            <span>Scope — which documents?</span>
            <input
              id="kanban-scope"
              value={scope}
              placeholder="folder:<path>, tag:<tag>, type:<type>, or blank for everything"
              onChange={(event) => {
                setScope(event.target.value);
              }}
            />
          </label>
        )}

        {problem === null ? null : (
          <p className="kanban-problem" role="alert">
            {problem}
          </p>
        )}

        <div className="kanban-actions">
          <button type="button" className="kanban-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="kanban-save">
            {mode === "create" ? "Create the board" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
