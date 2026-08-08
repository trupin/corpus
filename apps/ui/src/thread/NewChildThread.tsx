import {
  COMPOSER_PRIMARY_KEY,
  composerReachesAgent,
  handleComposerKeyDown,
  threadWeightScope,
  useComposerWeight,
  useCreateThread,
  WeightPicker,
  type RowNotice,
} from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { GrowingTextarea } from "./GrowingTextarea";

/**
 * Commenting on a turn (SPEC.md §6's recursion). One `POST /api/threads` with
 * `parent` set to the **thread** and a text-quote selector into the turn — the
 * same call a comment on a document makes, because a thread *is* a document and
 * §6 says the recursion is the same mechanism, not a second one.
 *
 * Deliberately not a second composer: it carries no attachments and no agent
 * toggle, because the thing being created is a conversation, and its first turn
 * is the question. Everything else about it happens in the child card's own
 * composer, which is the full one.
 *
 * Its keys are the kit's contract (SPEC.md §11) — `↵` newline, `⌘↵` comment,
 * `esc` cancel. Until UI-052 this box spelled them itself and got them wrong: it
 * sent on any `Enter`, including the one that **commits an IME composition**, so
 * typing a Japanese comment posted it mid-word. The contract carries that guard
 * for every composer now, which is why this one no longer states it.
 */

export interface NewChildThreadProps {
  /** The thread being commented on — the new thread's `parent`. */
  readonly parentThreadId: string;
  /** Quote the child anchors to (a line of the turn). */
  readonly anchorText: string;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function NewChildThread({
  parentThreadId,
  anchorText,
  onDone,
  onCancel,
  onNotify,
}: NewChildThreadProps): ReactElement {
  const [text, setText] = useState("");
  const create = useCreateThread();
  /*
   * The conversation this comment is made **in** is the parent thread, so this
   * box and that thread's reply box share one standing choice (SPEC.md §11's
   * rider). It is offered here rather than withheld because §11 enumerates this
   * surface; it is never live, because this box sends `requestsAgent: false`
   * unconditionally — a comment on a turn is a note until the child card's own
   * composer says otherwise. Presentation only: the choice is kept and travels.
   */
  const weight = useComposerWeight(threadWeightScope(parentThreadId));
  const live = composerReachesAgent({ requestsAgent: false });

  const send = (): void => {
    const body = text.trim();
    if (body === "" || create.isPending) return;
    create.mutate(
      {
        parent: parentThreadId,
        selector: { exact: anchorText },
        body,
        // Omitted would be "enqueue if engaged"; a comment on a turn is a note
        // until the person says otherwise, and the child card's composer is
        // where they say it.
        requestsAgent: false,
        ...weight.request,
      },
      {
        onSuccess: () => {
          setText("");
          onDone();
        },
        onError: (error) => {
          onNotify({ tone: "error", message: `Comment failed — ${error.message}` });
        },
      },
    );
  };

  return (
    <div className="composer child-composer" data-child-composer={parentThreadId}>
      <GrowingTextarea
        autoFocus
        value={text}
        placeholder="Comment on this turn"
        aria-label="Comment on this turn"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          handleComposerKeyDown(event, { onPrimary: send, onEscape: onCancel });
        }}
      />
      <WeightPicker weight={weight} live={live} surface={`child:${parentThreadId}`} />
      <div className="composer-foot">
        <span className="composer-hint">creates a child thread</span>
        <button
          type="button"
          className="send"
          disabled={text.trim() === "" || create.isPending}
          onClick={send}
        >
          Comment {COMPOSER_PRIMARY_KEY}
        </button>
      </div>
    </div>
  );
}
