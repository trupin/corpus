import {
  AttachButton,
  AutocompleteMenu,
  COMPOSER_PRIMARY_KEY,
  composerAddress,
  ComposerAddress,
  composerReachesAgent,
  docWeightScope,
  handleComposerKeyDown,
  PendingAttachments,
  useAttachmentIntake,
  useAutocomplete,
  useComposerRecipient,
  useComposerWeight,
  useCreateThread,
  type PendingAttachment,
  type RowNotice,
} from "@corpus/kit";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { GrowingTextarea } from "../thread/GrowingTextarea";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer";

/**
 * The comments list's own composer (SPEC.md §11, rider signed 2026-08-04): *"A
 * comment does not require a selection. The comments list carries a composer, so
 * a remark about the document as a whole starts a thread with no anchor (§6)."*
 *
 * **It always starts a NEW thread**, and that is the signed answer rather than a
 * default: *"a second, unrelated remark starts its **own** thread rather than
 * joining the first, so topics stay separately resolvable"* (UI-067). It never
 * appends to Capture's unanchored thread or to any other — replying to an
 * existing conversation is what each row's own reply box is for.
 *
 * **What it sends is `POST /api/threads` with `parent` and no `selector`** — the
 * shape §6 already defines for a whole-document comment, not a new kind of
 * object. Nothing else about the thread is different: it is listed, filtered,
 * collapsed, resolved and replied to exactly like a thread that came from a
 * selection.
 *
 * Everything below the field is the reply box's, not a second implementation:
 * the same attachment intake by all three of §6's routes, the same `@` / `/` /
 * `[[` autocomplete, the same address line, the same tri-state `◉ ask agent`
 * toggle where `○ note only` sends an explicit `false`. Its keys are the kit's
 * contract — `↵` newline, `⌘↵` sends — through `handleComposerKeyDown`, which is
 * the one place they are decided.
 */

export const NEW_COMMENT_PLACEHOLDER =
  "Comment on this document — @ route · / skill · [[ link · paste or drop files";
export const NEW_COMMENT_SEND_LABEL = `Comment ${COMPOSER_PRIMARY_KEY}`;
export const NEW_COMMENT_HINT = "starts a new thread";

export interface NewCommentComposerProps {
  readonly docId: string;
  readonly onNotify: (notice: RowNotice) => void;
}

export function NewCommentComposer({ docId, onNotify }: NewCommentComposerProps): ReactElement {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [asking, setAsking] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const intake = useAttachmentIntake();
  const create = useCreateThread();
  /*
   * A comment on the document is a thread on the document, so the document is
   * both the weight scope §11's rider names and the point §7's recipient walk
   * climbs from — the same two the selection composer uses for the same reason.
   */
  const weight = useComposerWeight(docWeightScope(docId));
  const recipient = useComposerRecipient({ start: docId });
  const address = composerAddress({
    weight,
    recipient,
    live: composerReachesAgent({ requestsAgent: asking }),
  });

  const applyCompletionResult = useCallback((result: { text: string; caret: number }) => {
    setText(result.text);
    setCaret(result.caret);
    const element = input.current;
    if (element !== null) {
      element.value = result.text;
      element.setSelectionRange(result.caret, result.caret);
      element.focus();
    }
  }, []);

  const autocomplete = useAutocomplete({
    value: text,
    caret,
    onComplete: applyCompletionResult,
  });

  useLayoutEffect(() => {
    if (!autocomplete.isOpen || input.current === null) return;
    const rect = input.current.getBoundingClientRect();
    setMenuStyle({ top: rect.bottom + 4, left: rect.left });
  }, [autocomplete.isOpen, autocomplete.items.length]);

  // Either half is a comment: §6 allows a first turn that is a file and no words.
  const hasContent = text.trim() !== "" || intake.pending.length > 0;
  const canSend = hasContent && !create.isPending;

  const send = useCallback(() => {
    if (!hasContent || create.isPending) return;
    const body = text.trim();
    const attachments: readonly PendingAttachment[] = intake.take();
    setText("");
    setCaret(0);
    create.mutate(
      {
        parent: docId,
        // **No selector**, which is the whole of what makes this a whole-document
        // comment (SPEC.md §6: `anchor: null`). `null` rather than an omission is
        // the composer's word for "no selection", and the one the global Ask
        // already sends.
        selector: null,
        body,
        requestsAgent: asking,
        ...address.request,
        ...(attachments.length === 0
          ? {}
          : { files: attachments.map((attachment) => attachment.file) }),
      },
      {
        onSuccess: (result) => {
          // §7: an override "never persists past the message it was set on".
          recipient.clear();
          intake.release(attachments);
          for (const warning of result.warnings) {
            onNotify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
          }
        },
        onError: (error) => {
          // Nothing was written, so the composer goes back to exactly what it
          // held — words, files, and the lane it named. `refuse` keeps the pick
          // only for the refusal that is *about* the lane (UI-118).
          recipient.refuse(error);
          setText(body);
          setCaret(body.length);
          intake.restore(attachments);
          onNotify({ tone: "error", message: `Comment failed — ${error.message}` });
        },
      },
    );
  }, [address.request, asking, create, docId, hasContent, intake, onNotify, recipient, text]);

  return (
    <div
      className={[
        "composer",
        "cm-new",
        intake.dropping ? "dropping" : "",
        hasContent ? "in-use" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-new-comment={docId}
      data-dropzone={`comments:${docId}`}
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
    >
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />

      <GrowingTextarea
        ref={input}
        value={text}
        placeholder={NEW_COMMENT_PLACEHOLDER}
        aria-label="Comment on this document"
        data-composer={`comments:${docId}`}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart);
        }}
        onPaste={intake.onPaste}
        onKeyDown={(event) => {
          handleComposerKeyDown(event, { claim: autocomplete.handleKeyDown, onPrimary: send });
        }}
      />

      <div className="composer-foot">
        <AttachButton surface={`comments:${docId}`} onFiles={intake.add} />
        <ComposerAddress address={address} surface={`comments:${docId}`} />
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
        {/* The one sentence that says this box never joins the thread above it.
            It truncates into the foot like the reply box's hint does, so the
            whole of it rides on a `title` (SHARED-057 clause 2). */}
        <span className="composer-hint" title={NEW_COMMENT_HINT}>
          {NEW_COMMENT_HINT}
        </span>
        <button
          type="button"
          className="send"
          data-new-comment-send
          disabled={!canSend}
          onClick={send}
        >
          {NEW_COMMENT_SEND_LABEL}
        </button>
      </div>

      <AutocompleteMenu
        open={autocomplete.isOpen}
        items={autocomplete.items}
        activeIndex={autocomplete.activeIndex}
        onHover={autocomplete.setActiveIndex}
        onChoose={autocomplete.choose}
        style={menuStyle}
        label="Comment completions"
      />
    </div>
  );
}
