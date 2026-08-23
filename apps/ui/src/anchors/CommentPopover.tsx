import {
  AttachButton,
  COMPOSER_PRIMARY_KEY,
  composerAddress,
  ComposerAddress,
  composerReachesAgent,
  handleComposerKeyDown,
  PendingAttachments,
  useAttachmentIntake,
  useComposerRecipient,
  useComposerWeight,
  unknownRecipientLane,
  type ComposerRecipientRestore,
  type PendingAttachment,
} from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer";
import { usePopoverDrag, type PopoverAnchor } from "./popoverDrag";

/**
 * The composer that opens on 💬 Comment — a composer, not a dialog.
 *
 * It takes what you want to say **and what you want to say it with**, offers one
 * choice (whether the agent is being asked), and submits. Nothing about the
 * anchor is configurable: the quote is the text that was selected, shown so the
 * person can see what they are commenting on, and SPEC.md §6 makes it a selector
 * rather than a setting.
 *
 * **It takes attachments by all three of §6's routes** — the 📎 picker, a paste
 * and a drop — because §10's rider says every composer does, naming "a comment
 * on a document selection" in its own list: *"a comment is a comment wherever it
 * starts; which surface it was written in decides nothing about what it can
 * carry"* (UI-111). The intake, the chips and the button are the reply box's,
 * not a second implementation of them.
 *
 * **A comment may be attachment-only.** §6 allows a first turn that is a file
 * and no words, and the transport already does — `POST /api/threads` goes
 * multipart with an omitted `text` — so the send button answers to either.
 *
 * **The toggle is the tri-state `requestsAgent`**, exactly as
 * `ThreadComposer`'s is: `○ note only` sends an explicit `false`, because an
 * omitted flag means "enqueue if the body mentions the agent" and would turn a
 * note into a job (sprint-011 Adjudication 11).
 *
 * **It can be moved off what it is about** (UI-112). It opens at the selection,
 * which for anything longer than a phrase is on top of the evidence — the figure
 * two lines up, the sentence a pronoun refers to. The grip at its head picks it
 * up, by pointer or by arrow key, and the position lasts as long as this
 * opening: a place chosen to clear one passage says nothing about the next.
 *
 * **Which side of the selection it opens on is derived, not chosen** (UI-159).
 * The words cut the room the chrome has left into two, and the box takes the
 * larger part, so a passage near the foot of a screen crowded with chrome opens
 * a composer *above* it rather than one wedged against the bottom edge with its
 * Send button off-screen. It is re-derived while it is open — an attachment chip
 * makes the box taller, and the box moves rather than the button leaving. What
 * makes that affordable is the other half of UI-112 — the words are lit in the
 * document from the moment this opens, so the box no longer has to sit on them
 * to say which they were.
 *
 * It registers in the escape chain at `Popover` priority, above the reader and
 * above focus mode, so Escape closes the popover and leaves the document open
 * (sprint-011 TEST-101).
 *
 * Its keys are the kit's contract (SPEC.md §10): `↵` is a newline, `⌘↵`
 * comments, `esc` closes.
 */

export const COMMENT_PLACEHOLDER = "Comment — @ route · / skill · [[ link · paste or drop files";
export const COMMENT_SUBMIT_LABEL = `Comment ${COMPOSER_PRIMARY_KEY}`;

/**
 * The grip's accessible name.
 *
 * It deliberately contains neither "comment" nor "Comment". Two existing
 * queries would otherwise become ambiguous the moment this button appeared: the
 * send button is found by `/Comment/`, and every e2e spec fills the field with
 * `getByLabel("Comment")` — which is a **substring** match in Playwright, so a
 * grip called "Move this comment box" resolved that locator to two elements.
 * Caught by the real-app drill for UI-112, not by a unit test.
 */
export const COMMENT_MOVE_LABEL = "Move this composer";
export const COMMENT_MOVE_HINT = "Move this composer — drag it, or use the arrow keys";

/**
 * What a refused send hands back, so the composer that re-opens is the one that
 * closed rather than an empty one (UI-111).
 *
 * The attachments are the very objects that were taken — their previews are
 * still live, because `take()` does not revoke — so restoring them costs no
 * re-read of the files and shows the same thumbnails.
 */
export interface CommentRestore {
  readonly text: string;
  readonly attachments: readonly PendingAttachment[];
  /**
   * The lane the refused comment was addressed to, and whether the server
   * refused **that lane** (SPEC.md §7's `422`, UI-118).
   *
   * It comes back for the reason the words and the attachments do, and for one
   * more: this composer's pick is the only part of a refused send that the
   * person cannot see was lost. Dropping it would put the retry back on the
   * computed default — worked out here, from the same cached roster that
   * produced the pick the server has just said is stale — and route it to
   * somebody they never addressed, without a word anywhere.
   */
  readonly recipient?: ComposerRecipientRestore | undefined;
}

/**
 * The recipient half of a {@link CommentRestore}, from what the refused send
 * stated and how the server refused it.
 *
 * A host builds it in its `onError` and knows both halves already. `refused` is
 * true only for a `422` naming **this** lane: any other failure leaves the pick
 * intact but unrefused, so the composer comes back holding it without claiming
 * a verdict the server never gave (UI-118).
 */
export function restoredRecipient(
  stated: { readonly recipient?: string },
  error: unknown,
): ComposerRecipientRestore | undefined {
  const lane = stated.recipient;
  if (lane === undefined) return undefined;
  return { chosen: lane, refused: unknownRecipientLane(error) === lane };
}

export interface CommentPopoverProps {
  /** The markdown the thread will be anchored to, shown for confirmation. */
  readonly quote: string;
  /**
   * The selection the popover hangs off, as the two edges it can be put against
   * (UI-159): `below` is where a box under the words starts, `above` is where a
   * box over them ends. Which of the two it takes is decided here, from the room
   * the chrome has left — a host states where the words are and never where the
   * box goes.
   */
  readonly anchor: PopoverAnchor;
  readonly pending: boolean;
  /**
   * Which conversation this comment's weight belongs to (SPEC.md §10's rider) —
   * `docWeightScope(docId)` for a comment on a document, `threadWeightScope(id)`
   * for one on a turn. The host owns it because the host knows what is being
   * commented on; this popover is one component in two placements.
   */
  readonly weightScope: string;
  /**
   * The conversation this comment lands in — the document it is on, or the
   * thread whose turn it hangs off (SPEC.md §7's scope walk starts there).
   * The host owns it for `weightScope`'s reason: the host knows what is being
   * commented on, and this popover is one component in two placements.
   */
  readonly recipientScope: string | null;
  /**
   * What a previous send left behind when the server refused it, or nothing on
   * a fresh selection. The host holds it, because the host is what unmounts
   * this composer on submit.
   */
  readonly restore?: CommentRestore | undefined;
  /**
   * The third argument is what this composer **states**, spread onto the
   * request: the weight it was set at and the recipient it was addressed to,
   * each present only when stated and `{}` when neither was. Passed as an object
   * rather than as two `string | undefined`s so absence has one spelling all the
   * way to the wire — which for the recipient is the whole mechanism, since a
   * default nobody touched is sent by omitting the field (SPEC.md §7). A pick is
   * present whether or not it matches that default (UI-118).
   *
   * The fourth is the attachments, **taken** from the composer as they are
   * handed over: their previews are not revoked, so the host can put them back
   * on a refusal, and must free them (`releaseAttachments`) when the post lands.
   * `body` may be empty when they are not (§6).
   */
  readonly onSubmit: (
    body: string,
    requestsAgent: boolean,
    stated: { readonly weight?: string; readonly recipient?: string },
    attachments: readonly PendingAttachment[],
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
  anchor,
  pending,
  weightScope,
  recipientScope,
  restore,
  onSubmit,
  onClose,
}: CommentPopoverProps): ReactElement {
  const [text, setText] = useState(restore?.text ?? "");
  const [asking, setAsking] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = usePopoverDrag(anchor, box);
  const intake = useAttachmentIntake(restore?.attachments);
  /*
   * Read from cache, never fetched here. The level set is one shared query the
   * board warms at app level, so the control is drawn in this popover's **first**
   * paint: a popover that grew a row after opening would move things under the
   * pointer, which is the bug UI-073 and UI-074 exist about.
   */
  const weight = useComposerWeight(weightScope);
  const recipient = useComposerRecipient({ start: recipientScope, restore: restore?.recipient });
  /*
   * The address (UI-126): who answers, at what weight, one line above the foot.
   * What it hands the host is `address.request` — the weight only where a
   * level was offered and chosen, so `○ note only` states none and a resident
   * recipient's designation-time weight is named rather than overridden
   * (SPEC.md §7, rider signed 2026-08-19).
   */
  const address = composerAddress({
    weight,
    recipient,
    live: composerReachesAgent({ requestsAgent: asking }),
  });

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Either alone is a comment: §6's first turn needs text, a file, or both.
  const canSend = (text.trim() !== "" || intake.pending.length > 0) && !pending;

  const send = (): void => {
    if (!canSend) return;
    // Taken, not read: the popover closes on submit, and the snapshot has to
    // outlive it for the host to put back if the post is refused.
    // The pick is handed over with the message and never kept here: this
    // popover unmounts on submit, so there is nowhere for an override to
    // persist to — §7's third prohibition, enforced by the surface's own
    // lifetime. A *refused* send is the one exception, and it is not a
    // persisting override: nothing was written, so `restore` brings the same
    // unsent message back whole — words, files and the lane it named alike.
    onSubmit(text.trim(), asking, address.request, intake.take());
  };

  return createPortal(
    <div
      ref={box}
      className={[
        "comment-pop",
        "open",
        intake.dropping ? "dropping" : "",
        drag.dragging ? "dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-dropzone="comment"
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
      role="dialog"
      aria-label="New comment"
      data-comment-pop
      style={{
        top: `${String(Math.round(drag.top))}px`,
        left: `${String(Math.round(drag.left))}px`,
      }}
      // Clicking inside must not collapse the selection the anchor comes from.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <button
        type="button"
        className="cm-drag"
        data-comment-drag
        aria-label={COMMENT_MOVE_LABEL}
        title={COMMENT_MOVE_HINT}
        onPointerDown={drag.onPointerDown}
        onKeyDown={drag.onKeyDown}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <div className="cm-quote">“{quotePreview(quote)}”</div>
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />
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
        // A paste carrying files attaches them; a paste carrying only text
        // still types (the intake declines it), which is the whole of §6's
        // second route.
        onPaste={intake.onPaste}
        onKeyDown={(event) => {
          // The escape chain deliberately ignores keys typed inside a field —
          // otherwise `⌫` would close the reader instead of deleting a
          // character — so the field answers Escape itself. The registration
          // below is for every other case: a click landing elsewhere while the
          // popover is still open.
          handleComposerKeyDown(event, { onPrimary: send, onEscape: onClose });
        }}
      />
      <div className="composer-foot">
        <AttachButton surface="comment" onFiles={intake.add} />
        <ComposerAddress address={address} surface="comment" />
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
