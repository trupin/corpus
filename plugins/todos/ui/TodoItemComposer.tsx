import { useCreateThread } from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useDismissable } from "./dismiss.js";
import { clampToViewport } from "./PluginMenu.js";
import type { ItemSelector } from "./itemAnchor.js";
import type { TodoItemTarget } from "./TodoItemMenu.js";
import "./todos.css";

/**
 * The composer *Comment on item* opens — a composer, not a dialog.
 *
 * SPEC.md §11 says what the core menu's Comment does, and this is the same act
 * one surface over: *"captures the text-quote selector and opens the thread
 * composer, §6"*. It does **not** create a thread on its own, here or there: a
 * first turn is required (`CreateThreadRequest.body` is `min(1)`), and a menu
 * item that silently posted an empty or invented comment would be a different
 * act wearing the same name.
 *
 * Modelled on `apps/ui/src/anchors/CommentPopover.tsx` down to its keys — the
 * quote shown for confirmation, `↵` sends, `⇧↵` newlines, `esc` closes, and the
 * tri-state agent toggle that sends an explicit `false` for a note (an omitted
 * flag means "enqueue if the body mentions the agent", which would turn a note
 * into a job). It is a copy because the kit publishes no composer; the *thread*
 * it produces is not a copy of anything — `useCreateThread` is the kit's own
 * hook and the request is the ordinary §6 one, selector included.
 *
 * **Dismissal is `./dismiss.ts`'s, the same as `PluginMenu`'s.** Core's popover
 * answers Escape from its field *and* through the escape registry, which a
 * plugin cannot join; answering only from the field left a real hole — press
 * the agent toggle, so focus is on a button, then Escape, and the app's own
 * chain closed the reader **underneath** while this popover stayed open.
 */

/** The quote, short enough to sit in a popover without becoming the popover. */
export function quotePreview(quote: string, limit = 90): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export const ASK_AGENT_LABEL = "◉ ask agent";
export const NOTE_ONLY_LABEL = "○ note only";
export const COMMENT_PLACEHOLDER = "Comment on this item";

export interface TodoItemComposerProps {
  readonly target: TodoItemTarget;
  readonly selector: ItemSelector;
  readonly clientX: number;
  readonly clientY: number;
  /** The created thread — the caller decides where to take the user next. */
  readonly onCreated: (target: TodoItemTarget, threadId: string) => void;
  readonly onClose: () => void;
}

export function TodoItemComposer({
  target,
  selector,
  clientX,
  clientY,
  onCreated,
  onClose,
}: TodoItemComposerProps): ReactElement {
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const create = useCreateThread();

  useDismissable(surface, onClose);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const pending = create.isPending;
  const canSend = text.trim() !== "" && !pending;

  const send = (): void => {
    if (!canSend) return;
    setError(null);
    create.mutate(
      {
        parent: target.docId,
        selector,
        body: text.trim(),
        requestsAgent: asking,
      },
      {
        onSuccess: (result) => {
          onCreated(target, result.thread.id);
        },
        // The popover stays open on a refusal: the words the user typed are
        // still in it, and closing would throw them away with the error.
        onError: (cause: Error) => {
          setError(cause.message);
        },
      },
    );
  };

  const placement = clampToViewport(
    clientX,
    clientY,
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
    { width: 320, height: 160 },
  );

  return (
    <div
      ref={surface}
      className="todo-comment-pop"
      role="dialog"
      aria-label="New comment on todo item"
      data-todo-comment
      style={{ left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }}
    >
      <div className="todo-cm-quote">“{quotePreview(selector.exact)}”</div>
      <textarea
        ref={input}
        className="todo-cm-input"
        value={text}
        rows={2}
        placeholder={COMMENT_PLACEHOLDER}
        aria-label="Comment"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          // Escape is not handled here: `useDismissable` takes it on `window`
          // in the capture phase, so it answers wherever focus is inside this
          // popover — and stops it before the app's chain, which is the half a
          // field-scoped handler could not do.
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
      />
      <div className="todo-comment-foot">
        <button
          type="button"
          className={asking ? "todo-toggle on" : "todo-toggle"}
          aria-pressed={asking}
          onClick={() => {
            setAsking((current) => !current);
          }}
        >
          {asking ? ASK_AGENT_LABEL : NOTE_ONLY_LABEL}
        </button>
        <button
          type="button"
          className="todo-send"
          disabled={!canSend}
          data-todo-comment-send
          onClick={send}
        >
          Comment ↵
        </button>
      </div>
      {error === null ? null : (
        <p className="todo-cm-error" role="alert">
          Comment failed — {error}
        </p>
      )}
    </div>
  );
}
