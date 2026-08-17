import {
  AttachButton,
  COMPOSER_PRIMARY_KEY,
  handleComposerKeyDown,
  PendingAttachments,
  useAttachmentIntake,
  useCreateThread,
} from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useDismissable } from "./dismiss.js";
import { clampToViewport } from "./PluginMenu.js";
import type { ItemSelector } from "./itemAnchor.js";
import type { TodoItemTarget } from "./TodoItemMenu.js";
import "@corpus/kit/composer.css";
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
 * Modelled on `apps/ui/src/anchors/CommentPopover.tsx` — the quote shown for
 * confirmation, `esc` closes, and the tri-state agent toggle that sends an
 * explicit `false` for a note (an omitted flag means "enqueue if the body
 * mentions the agent", which would turn a note into a job). It is a copy because
 * the kit publishes no composer; the *thread* it produces is not a copy of
 * anything — `useCreateThread` is the kit's own hook and the request is the
 * ordinary §6 one, selector included.
 *
 * **The keys are not a copy — they are the kit's `handleComposerKeyDown`.**
 * SPEC.md §11's composer contract binds "any composer a plugin contributes", so
 * `↵` inserts a newline, `⌘↵` sends, and an IME composition commit never sends.
 * The plugin does not re-implement that sentence and does not spell the chord
 * itself: the label is built from `COMPOSER_PRIMARY_KEY`, so the glyph on this
 * button cannot drift from the glyph on the app's own composers (PLUGINS-011).
 * This is the whole extent of what `@corpus/kit` had to publish for a plugin to
 * obey the contract, and it published it.
 *
 * **Dismissal is `./dismiss.ts`'s, the same as `PluginMenu`'s.** Core's popover
 * answers Escape from its field *and* through the escape registry, which a
 * plugin cannot join; answering only from the field left a real hole — press
 * the agent toggle, so focus is on a button, then Escape, and the app's own
 * chain closed the reader **underneath** while this popover stayed open.
 *
 * **It takes attachments by all three of §6's routes** — the 📎 picker, a paste
 * and a drop onto the popover, with chip previews before sending (PLUGINS-012).
 * §11's rider names "any composer a plugin contributes" in the same breath as
 * the board's own, and the reference plugin is the one that has to demonstrate
 * it rather than be the surface without it. Every part of that is the kit's:
 * `useAttachmentIntake` normalises the three routes, `PendingAttachments` draws
 * the chips, `AttachButton` is the 📎 and its hidden input, and
 * `@corpus/kit/composer.css` carries their anatomy — nothing here is a copy,
 * which is the whole point of UI-070 having published them. The only thing this
 * file owns is the highlight class, because the dropzone is the *surface* and
 * only this file knows what this surface looks like.
 *
 * **A comment may be attachment-only** (§6): the send answers to a file with no
 * words, and `useCreateThread` switches to multipart on its own.
 *
 * **A refusal loses neither the words nor the files.** The kit publishes
 * `take()`/`restore()` for a composer that clears itself optimistically and has
 * to put its chips back when the post fails; this one clears nothing until the
 * thread exists, so the chips stay where the words stay and the same send can
 * be pressed again. The previews are revoked by the intake's own unmount, which
 * is the moment `onCreated` closes this popover.
 */

/** The quote, short enough to sit in a popover without becoming the popover. */
export function quotePreview(quote: string, limit = 90): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export const ASK_AGENT_LABEL = "◉ ask agent";
export const NOTE_ONLY_LABEL = "○ note only";
export const COMMENT_PLACEHOLDER = "Comment on this item";

/** Every submit control names its key, and this one names the kit's (§11). */
export const COMMENT_SUBMIT_LABEL = `Comment ${COMPOSER_PRIMARY_KEY}`;

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
  const intake = useAttachmentIntake();

  useDismissable(surface, onClose);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const pending = create.isPending;
  // A file with no words is a comment (SPEC.md §6), so either half arms the send.
  const canSend = (text.trim() !== "" || intake.pending.length > 0) && !pending;

  const send = (): void => {
    if (!canSend) return;
    setError(null);
    create.mutate(
      {
        parent: target.docId,
        selector,
        body: text.trim(),
        requestsAgent: asking,
        files: intake.pending.map((attachment) => attachment.file),
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
      className={intake.dropping ? "todo-comment-pop dropping" : "todo-comment-pop"}
      role="dialog"
      aria-label="New comment on todo item"
      data-todo-comment
      // The dropzone is the whole popover, not the field: a person dragging a
      // screenshot aims at the box they can see. The highlight is this file's
      // own class for the reason `composer.css` states — a bare `.dropping`
      // rule in the kit would paint whichever surface happened to match.
      data-dropzone="todo-item-comment"
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
      style={{ left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }}
    >
      <div className="todo-cm-quote">“{quotePreview(selector.exact)}”</div>
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />
      {/* The wrapper is the box; the field inside it is transparent and grows
          with the draft, because `↵` is a newline here now and a two-row field
          that scrolls its first line out of sight is a poor place to write more
          than one. The mirror is the browser laying out the same string in the
          same font — no `scrollHeight` read, nothing to fall out of sync. It is
          the technique `apps/ui`'s `GrowingTextarea` uses and not that
          component, which a plugin may not import (§10). */}
      <div className="todo-cm-grow" data-replicated-value={text}>
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
          // A paste carrying files is an attachment, never base64 in the field;
          // a paste carrying none falls through to ordinary text insertion.
          onPaste={intake.onPaste}
          onKeyDown={(event) => {
            // No `onEscape`: `useDismissable` takes the key on `window` in the
            // capture phase, so it answers wherever focus is inside this
            // popover — and stops it before the app's chain, which is the half
            // a field-scoped handler could not do. It never reaches here.
            handleComposerKeyDown(event, { onPrimary: send });
          }}
        />
      </div>
      <div className="todo-comment-foot">
        <AttachButton surface="todo-item-comment" onFiles={intake.add} />
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
          {COMMENT_SUBMIT_LABEL}
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
