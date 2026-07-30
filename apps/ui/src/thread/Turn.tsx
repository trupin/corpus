import { isPendingTurn, MarkdownView, type RowNotice, type ThreadTurn } from "@corpus/kit";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { FormBlock } from "./FormBlock";
import { parseFormBlock, splitFormFence } from "./parseFormBlock";
import { splitTurnAttachments } from "./attachmentRefs";
import { TurnAttachments } from "./TurnAttachments";
import { turnStamp } from "./turnStamp";

/**
 * One turn of a conversation (`design/index.html`'s `.turn`).
 *
 * The turn's **timestamp is its identity** (SPEC.md §6) — it is the React key,
 * it is what `DELETE …/turns/{ts}` targets, and it is what identifies the form a
 * turn carries. Nothing here is ever keyed by array index.
 */

/** The unarmed and armed labels of the delete control. */
export const DELETE_LABEL = "✕";
export const DELETE_ARMED_LABEL = "delete?";

/**
 * The trace grammar: the final line of an **agent** turn, beginning with `↳ `.
 *
 * The prototype shows a trace line under agent turns describing what the agent
 * changed, and SPEC.md does not say how one is written — there is no `trace`
 * field on `Turn`, because a turn is markdown a person can read in a file. So
 * the convention is the one the prototype already draws: the arrow itself is
 * stripped here and re-supplied by CSS `::before`, which is what keeps it out of
 * the document's bytes.
 */
/**
 * The arrow **and its space**. `↳x` is not the grammar, and neither is a bare
 * `↳` on its own line: matching either would strip a character off a body that
 * merely started with the glyph and print nothing in its place.
 */
const TRACE_PREFIX = "↳ ";

export interface TurnSplit {
  readonly body: string;
  readonly trace: string | null;
}

/**
 * The trace, or nothing — read off the **unindented final line** of the turn as
 * it was written.
 *
 * Three exactness rules, each of which is a way the loose version claimed a
 * trace that was not one (PR #10 finding 11):
 *
 * - the trailing space is part of the prefix (above);
 * - the line is **not** left-trimmed first, so an indented `↳ ` — a list item's
 *   continuation, a line inside a fence, a quoted reply — stays content;
 * - the line examined is the last line of `body` itself. Splitting anything off
 *   the end first (the attachment references, say) promotes an earlier line
 *   into final position, and §6's grammar is about the line a turn *closes*
 *   with, not about whichever line happens to be last after a rewrite.
 */
export function splitTrace(body: string, author: string): TurnSplit {
  if (author !== "agent") return { body, trace: null };
  const lines = body.split("\n");
  const last = (lines.at(-1) ?? "").trimEnd();
  if (!last.startsWith(TRACE_PREFIX)) return { body, trace: null };
  const trace = last.slice(TRACE_PREFIX.length).trim();
  // `↳` followed by nothing but blanks reports no action; it is not a trace,
  // and rendering the arrow alone would be the UI inventing one.
  if (trace === "") return { body, trace: null };
  lines.pop();
  return { body: lines.join("\n").trimEnd(), trace };
}

export interface TurnProps {
  readonly threadId: string;
  readonly turn: ThreadTurn;
  /** The answer a later turn recorded for this turn's form, if any. */
  readonly answeredForm: string | null;
  /** This turn's form was answered from here — see `FormBlock.onAnswered`. */
  readonly onAnsweredForm?: ((formTs: string, option: string) => void) | undefined;
  readonly onOpenRef: (docId: string) => void;
  readonly onDelete: (ts: string) => void;
  /** Absent suppresses the per-turn comment affordance (a nested card at depth). */
  readonly onComment?: ((turn: ThreadTurn) => void) | undefined;
  readonly onNotify: (notice: RowNotice) => void;
  /** Child threads anchored into this turn. */
  readonly children?: ReactNode;
}

export function Turn({
  threadId,
  turn,
  answeredForm,
  onAnsweredForm,
  onOpenRef,
  onDelete,
  onComment,
  onNotify,
  children,
}: TurnProps): ReactElement {
  const [armed, setArmed] = useState(false);

  useEscapeLayer({
    active: armed,
    priority: EscapeLayerPriority.Popover,
    onEscape: () => {
      setArmed(false);
    },
  });

  useEffect(() => {
    if (!armed) return undefined;
    const disarm = (event: MouseEvent): void => {
      if (event.target instanceof HTMLElement && event.target.closest("[data-turn-del]") !== null) {
        return;
      }
      setArmed(false);
    };
    document.addEventListener("mousedown", disarm);
    return () => {
      document.removeEventListener("mousedown", disarm);
    };
  }, [armed]);

  const pending = isPendingTurn(turn);
  // The trace is read first, off the turn's own last line. Splitting the
  // attachment references off first would let an earlier line inherit "final"
  // and be read as a trace it is not (PR #10 finding 11).
  const { body: unstamped, trace } = splitTrace(turn.body, turn.author);
  const { prose: body, attachments } = splitTurnAttachments(unstamped);
  // SPEC.md §6 makes a form something an *agent* turn carries, and the server
  // agrees: `POST …/form` 404s on a turn that is not the agent's. A user turn
  // that happens to quote a fence is a code block, not a question to answer.
  const fence =
    turn.author === "agent" ? splitFormFence(body) : { before: body, after: "", source: undefined };
  const form = fence.source === undefined ? { status: "none" as const } : parseFormBlock(body);

  return (
    <div className={pending ? "turn pending" : "turn"} data-turn-ts={turn.ts}>
      <div className="turn-who">
        <span className={turn.author === "agent" ? "who agent" : "who"}>{turn.author}</span>
        <span>{pending ? "sending…" : turnStamp(turn.ts)}</span>
        {onComment === undefined ? null : (
          <button
            type="button"
            className="turn-comment"
            title="Comment on this turn"
            aria-label={`Comment on the ${turn.author} turn`}
            disabled={pending}
            onClick={() => {
              onComment(turn);
            }}
          >
            💬
          </button>
        )}
        {/* SPEC.md §6: turn deletion is user-only. An agent turn has no control
            at all rather than a disabled one — a greyed button is a claim that
            the act exists and is unavailable, which is not what is true here. */}
        {turn.author === "user" && !pending ? (
          <button
            type="button"
            data-turn-del
            className={armed ? "turn-del armed" : "turn-del"}
            aria-label={armed ? "Confirm delete turn" : "Delete turn"}
            onClick={() => {
              if (!armed) {
                // Arming reaches no network at all: the confirmation IS the two
                // clicks, and only the second one is a request.
                setArmed(true);
                return;
              }
              setArmed(false);
              onDelete(turn.ts);
            }}
          >
            {armed ? DELETE_ARMED_LABEL : DELETE_LABEL}
          </button>
        ) : null}
      </div>

      <div className="turn-body">
        {form.status === "none" ? (
          <MarkdownView markdown={body} className="doc-body turn-markdown" onOpenRef={onOpenRef} />
        ) : (
          <>
            {fence.before === "" ? null : (
              <MarkdownView
                markdown={fence.before}
                className="doc-body turn-markdown"
                onOpenRef={onOpenRef}
              />
            )}
            {form.status === "ok" ? (
              <FormBlock
                form={form.form}
                threadId={threadId}
                formTs={turn.ts}
                answered={answeredForm}
                onAnswered={onAnsweredForm}
                onNotify={onNotify}
              />
            ) : (
              <div className="form-broken">
                <pre>
                  <code>{form.source}</code>
                </pre>
                <p className="form-warning" role="status">
                  This form could not be read — {form.reason}
                </p>
              </div>
            )}
            {fence.after === "" ? null : (
              <MarkdownView
                markdown={fence.after}
                className="doc-body turn-markdown"
                onOpenRef={onOpenRef}
              />
            )}
          </>
        )}
      </div>

      <TurnAttachments attachments={attachments} />
      {trace === null ? null : <div className="turn-trace">{trace}</div>}
      {children}
    </div>
  );
}
