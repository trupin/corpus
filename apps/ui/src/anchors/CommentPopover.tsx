import {
  COMPOSER_PRIMARY_KEY,
  composerReachesAgent,
  handleComposerKeyDown,
  useComposerWeight,
  WeightPicker,
} from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer";

/**
 * The composer that opens on 💬 Comment — a composer, not a dialog.
 *
 * It takes one thing (what you want to say), offers one choice (whether the
 * agent is being asked), and submits. Nothing about the anchor is configurable:
 * the quote is the text that was selected, shown so the person can see what
 * they are commenting on, and SPEC.md §6 makes it a selector rather than a
 * setting.
 *
 * **The toggle is the tri-state `requestsAgent`**, exactly as
 * `ThreadComposer`'s is: `○ note only` sends an explicit `false`, because an
 * omitted flag means "enqueue if the body mentions the agent" and would turn a
 * note into a job (sprint-011 Adjudication 11).
 *
 * It registers in the escape chain at `Popover` priority, above the reader and
 * above focus mode, so Escape closes the popover and leaves the document open
 * (sprint-011 TEST-101).
 *
 * Its keys are the kit's contract (SPEC.md §11): `↵` is a newline, `⌘↵`
 * comments, `esc` closes.
 */

export const COMMENT_PLACEHOLDER = "Comment — @ route · / skill · [[ link";
export const COMMENT_SUBMIT_LABEL = `Comment ${COMPOSER_PRIMARY_KEY}`;

export interface CommentPopoverProps {
  /** The markdown the thread will be anchored to, shown for confirmation. */
  readonly quote: string;
  /** Viewport coordinates of the selection the popover hangs off. */
  readonly top: number;
  readonly left: number;
  readonly pending: boolean;
  /**
   * Which conversation this comment's weight belongs to (SPEC.md §11's rider) —
   * `docWeightScope(docId)` for a comment on a document, `threadWeightScope(id)`
   * for one on a turn. The host owns it because the host knows what is being
   * commented on; this popover is one component in two placements.
   */
  readonly weightScope: string;
  /**
   * The third argument is the stated weight, spread onto the request: `{}` when
   * nothing was chosen. Passed as an object rather than a `string | undefined`
   * so absence has one spelling all the way to the wire.
   */
  readonly onSubmit: (
    body: string,
    requestsAgent: boolean,
    weight: { readonly weight?: string },
  ) => void;
  readonly onClose: () => void;
}

/** The quote, short enough to sit in a popover without becoming the popover. */
export function quotePreview(quote: string, limit = 90): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export function CommentPopover({
  quote,
  top,
  left,
  pending,
  weightScope,
  onSubmit,
  onClose,
}: CommentPopoverProps): ReactElement {
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  /*
   * Read from cache, never fetched here. The level set is one shared query the
   * board warms at app level, so the control is drawn in this popover's **first**
   * paint: a popover that grew a row after opening would move things under the
   * pointer, which is the bug UI-073 and UI-074 exist about.
   */
  const weight = useComposerWeight(weightScope);
  const live = composerReachesAgent({ requestsAgent: asking });

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const canSend = text.trim() !== "" && !pending;

  const send = (): void => {
    if (!canSend) return;
    onSubmit(text.trim(), asking, weight.request);
  };

  return createPortal(
    <div
      className="comment-pop open"
      role="dialog"
      aria-label="New comment"
      data-comment-pop
      style={{ top: `${String(Math.round(top))}px`, left: `${String(Math.round(left))}px` }}
      // Clicking inside must not collapse the selection the anchor comes from.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div className="cm-quote">“{quotePreview(quote)}”</div>
      <textarea
        ref={input}
        className="cm-input"
        value={text}
        rows={2}
        placeholder={COMMENT_PLACEHOLDER}
        aria-label="Comment"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          // The escape chain deliberately ignores keys typed inside a field —
          // otherwise `⌫` would close the reader instead of deleting a
          // character — so the field answers Escape itself. The registration
          // below is for every other case: a click landing elsewhere while the
          // popover is still open.
          handleComposerKeyDown(event, { onPrimary: send, onEscape: onClose });
        }}
      />
      <WeightPicker weight={weight} live={live} surface="comment" />
      <div className="composer-foot">
        <button
          type="button"
          className={asking ? "toggle on" : "toggle"}
          aria-pressed={asking}
          onClick={() => {
            setAsking((current) => !current);
          }}
        >
          {asking ? ASK_AGENT_LABEL : NOTE_ONLY_LABEL}
        </button>
        <button type="button" className="send" disabled={!canSend} data-comment-send onClick={send}>
          {COMMENT_SUBMIT_LABEL}
        </button>
      </div>
    </div>,
    document.body,
  );
}
