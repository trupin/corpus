import type { ReactElement } from "react";
import type { LegacyStorage } from "./legacy.js";
import "./todos.css";

/**
 * **What a todo document whose items are not in its body says for itself**
 * (PLUGINS-008).
 *
 * A workspace written before PLUGINS-005 keeps its items in an `items`
 * frontmatter key, and since PLUGINS-006 a todo document renders in the core
 * editor — so such a document opened as a blank page with a healthy-looking
 * stats strip above it, and the remedy was reachable from nothing on screen.
 * The two states either side of it are worse: a hand-edited key that no longer
 * parses rendered *no* chrome at all, and a document storing items in both
 * places rendered a perfectly normal reader over a document the server refuses
 * every write to — a refusal only the CLI ever saw.
 *
 * It lives in the plugin's own `DocPanel` (sprint-023 OC1) because the format
 * is the plugin's and `DocPanelProps` already carries the whole document.
 * SPEC.md §10's one-slot rule stands: this is a block inside that slot, not a
 * second injection point, and core knows nothing about it.
 *
 * **It offers no button.** `corpus todos migrate` is a CLI verb over *every*
 * remaining list (SPEC.md §12) — a per-document control here would be a second
 * migration surface with different semantics — so the notice names the verb and
 * says who runs it.
 *
 * The read-only list is **collapsed by default**: a 17-item legacy document
 * must not bury the body it sits above. It is markup, never a control — no
 * input, no button, no handler — so there is nothing here that can write.
 */

/** Two sentences per state: what is wrong, and what makes it right. */
interface Copy {
  readonly lead: string;
  /** Everything before the verb, and everything after it. */
  readonly before: string;
  readonly after: string;
}

const COPY: Readonly<Record<Exclude<LegacyStorage["kind"], "none">, Copy>> = {
  frontmatter: {
    lead:
      "This list still stores its items in its `items` frontmatter — the format todo lists used " +
      "before items became task-list lines in the document body. That is why the body below is " +
      "empty, and why none of these items can be checked, edited or commented on here.",
    before: "Ask the agent to migrate it, or run ",
    after: " yourself from the CLI — it converts every remaining list at once.",
  },
  malformed: {
    lead:
      "This list's `items` frontmatter has been hand-edited into something that no longer parses, " +
      "so its items cannot be shown, counted, or written to:",
    before: "Repair the frontmatter by hand, then ask the agent to run ",
    after: " (or run it from the CLI) to move the items into the body.",
  },
  /*
   * Deliberately precise about *who* is refused. Toggling a box in the editor
   * is an ordinary core body edit (SPEC.md §12) and still saves — it is the
   * plugin's item routes, the path the agent and the CLI take, that answer 400.
   * Saying "nothing can be written" would be a claim the user can disprove in
   * one click, which is how a notice stops being believed.
   */
  dual: {
    lead:
      "This document stores its items in two places — the task lines in the body below, and a " +
      "leftover `items` frontmatter key nothing on this screen shows. It needs migrating: until " +
      "one of the two lists is removed, the agent and the CLI refuse every item write they are " +
      "sent:",
    before: "Remove whichever list is stale, then ask the agent to run ",
    after: " (or run it from the CLI) to finish the move.",
  },
};

/** The verb, spelled exactly as it is typed. Named once, said everywhere. */
const MIGRATE = "corpus todos migrate";

export interface LegacyItemsNoticeProps {
  /** Anything but `none` — the panel renders nothing at all for that. */
  readonly state: Exclude<LegacyStorage, { kind: "none" }>;
}

export function LegacyItemsNotice({ state }: LegacyItemsNoticeProps): ReactElement {
  const copy = COPY[state.kind];
  const problems = state.kind === "frontmatter" ? [] : state.problems;
  const items = state.kind === "frontmatter" ? state.items : [];

  return (
    <section
      className={`todo-legacy todo-legacy-${state.kind}`}
      data-todo-legacy={state.kind}
      aria-label="Legacy todo item storage"
    >
      <p className="todo-legacy-lead">{copy.lead}</p>

      {problems.length === 0 ? null : (
        <ul className="todo-legacy-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <p className="todo-legacy-remedy">
        {copy.before}
        <code>{MIGRATE}</code>
        {copy.after}
      </p>

      {items.length === 0 ? null : (
        <details className="todo-legacy-details" data-todo-legacy-items={items.length}>
          <summary>
            {items.length} item{items.length === 1 ? "" : "s"}, stored in frontmatter
          </summary>
          <div className="todo-items todo-legacy-list">
            {items.map((item, index) => (
              <div
                key={`${String(index)}:${item.text}`}
                className={`t${item.done ? " done" : ""}`}
                data-todo-legacy-item={item.done ? "done" : "open"}
              >
                <span className="box">{item.done ? "☑" : "☐"}</span>
                <span className="todo-item-text">{item.text}</span>
                {item.due === undefined ? null : <span className="due">{item.due}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
