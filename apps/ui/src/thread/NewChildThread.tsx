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
  useCreateThread,
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
 * Deliberately smaller than the reply box — no agent toggle, because the thing
 * being created is a conversation and its first turn is the question, and the
 * rest happens in the child card's own composer, which is the full one.
 *
 * **What it is not smaller by is attachments** (SPEC.md §11's rider, signed
 * 2026-08-05): "a comment on a turn" is in the list of surfaces that take files
 * by picker, paste and drop, and this box used to say in a comment that it
 * carried none. It carries them now, on the same intake and the same chips as
 * every other composer (UI-111).
 *
 * Its keys are the kit's contract (SPEC.md §11) — `↵` newline, `⌘↵` comment,
 * `esc` cancel. Until UI-052 this box spelled them itself and got them wrong: it
 * sent on any `Enter`, including the one that **commits an IME composition**, so
 * typing a Japanese comment posted it mid-word. The contract carries that guard
 * for every composer now, which is why this one no longer states it.
 */

/**
 * What this box makes, and the only place the product says it. One constant so
 * the words and the `title` that reveals them cannot drift apart.
 */
export const CHILD_HINT = "creates a child thread";

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
  const intake = useAttachmentIntake();
  const create = useCreateThread();
  // The child thread's parent is this thread, so the walk starts where the
  // comment lands — the same node the server's enqueue walk would start from.
  const recipient = useComposerRecipient({ start: parentThreadId });
  /*
   * This box sends `requestsAgent: false` unconditionally, so its address sits
   * on §11's floor: the line says nobody is asked, the popover offers the
   * recipient rows alone, and no weight exists to state — a control that could
   * never act used to stand here dimmed, which UI-126 replaced with nothing
   * (SPEC.md §11: nothing to weigh where no work is asked for). The weight
   * input is deliberately omitted, not merely inert.
   */
  const address = composerAddress({
    recipient,
    live: composerReachesAgent({ requestsAgent: false }),
  });

  // Either alone is a comment (SPEC.md §6): a first turn needs text, a file, or
  // both.
  const hasContent = text.trim() !== "" || intake.pending.length > 0;

  const send = (): void => {
    const body = text.trim();
    if (!hasContent || create.isPending) return;
    // Held rather than taken: this box stays open until the server accepts, so
    // its chips stay on screen and only what was actually sent is cleared.
    const attachments = intake.pending;
    create.mutate(
      {
        parent: parentThreadId,
        selector: { exact: anchorText },
        body,
        // Omitted would be "enqueue if engaged"; a comment on a turn is a note
        // until the person says otherwise, and the child card's composer is
        // where they say it.
        requestsAgent: false,
        ...address.request,
        // Present only when there are files: an empty list would send a plain
        // comment as a multipart upload (`useCreateThread`).
        ...(attachments.length === 0
          ? {}
          : { files: attachments.map((attachment) => attachment.file) }),
      },
      {
        onSuccess: () => {
          // §7: an override routes one message and never persists past it.
          recipient.clear();
          setText("");
          // By id, not by emptying: a file added while the post was in flight
          // was never sent and must survive it.
          for (const attachment of attachments) intake.remove(attachment.id);
          onDone();
        },
        onError: (error) => {
          // Kept when the refusal *is* the lane, dropped otherwise (UI-118):
          // nothing was written, so a retry that silently fell back to this
          // build's computed default would route where nobody addressed.
          recipient.refuse(error);
          onNotify({ tone: "error", message: `Comment failed — ${error.message}` });
        },
      },
    );
  };

  return (
    <div
      className={["composer", "child-composer", intake.dropping ? "dropping" : ""]
        .filter(Boolean)
        .join(" ")}
      data-child-composer={parentThreadId}
      data-dropzone={`child:${parentThreadId}`}
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
    >
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />
      <GrowingTextarea
        autoFocus
        value={text}
        placeholder="Comment on this turn — paste or drop files"
        aria-label="Comment on this turn"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onPaste={intake.onPaste}
        onKeyDown={(event) => {
          handleComposerKeyDown(event, { onPrimary: send, onEscape: onCancel });
        }}
      />
      <div className="composer-foot">
        <AttachButton surface={`child:${parentThreadId}`} onFiles={intake.add} />
        <ComposerAddress address={address} surface={`child:${parentThreadId}`} />
        {/* Same reveal as the reply composer's hint, for the same reason: this
            foot truncates it, and this is the only place the box says what
            pressing Comment makes (SHARED-057 clause 2). */}
        <span className="composer-hint" title={CHILD_HINT}>
          {CHILD_HINT}
        </span>
        <button
          type="button"
          className="send"
          disabled={!hasContent || create.isPending}
          onClick={send}
        >
          Comment {COMPOSER_PRIMARY_KEY}
        </button>
      </div>
    </div>
  );
}
