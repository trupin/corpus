import {
  AttachButton,
  AutocompleteMenu,
  COMPOSER_PRIMARY_KEY,
  composerReachesAgent,
  handleComposerKeyDown,
  PendingAttachments,
  RecipientPicker,
  threadWeightScope,
  useAppendTurn,
  useAttachmentIntake,
  useAutocomplete,
  useComposerRecipient,
  useComposerWeight,
  WeightPicker,
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
import { GrowingTextarea } from "./GrowingTextarea";

/**
 * The thread composer (`design/index.html`'s `.composer`): one field, the shared
 * `@` / `/` / `[[` autocomplete, the `◉ ask agent` / `○ note only` toggle, and
 * three ways to attach a file.
 *
 * **Its keys are the kit's, not its own** (SPEC.md §11): `↵` is a newline and
 * `⌘↵` sends. That is why the field is a `GrowingTextarea` rather than the
 * mockup's `<input>` — a reply is prose, and prose has paragraphs.
 *
 * **The toggle is the tri-state `requestsAgent`, and `○ note only` sends an
 * explicit `false`.** Omitting it means "enqueue if the thread is already
 * engaged" (SPEC.md §8), which is the opposite of what the person just asked
 * for: on an engaged thread an omitted flag re-triggers the agent and the note
 * they meant to leave quietly becomes a job. `false` is the only spelling of
 * "note only" the wire has, and it suppresses the enqueue even when the text
 * carries an `@mention` — the toggle is an explicit instruction and the UI does
 * not overrule it. What the UI never does is *resolve* routing: it sends the raw
 * text and the flag, and the server parses mentions authoritatively (§8).
 */

/** Character for character from the prototype. */
export const COMPOSER_PLACEHOLDER = "Reply — @ route · / skill · [[ link · paste or drop files";

export const ASK_AGENT_LABEL = "◉ ask agent";
export const NOTE_ONLY_LABEL = "○ note only";
export const OPEN_HINT = "thread stays open";
export const RESOLVED_HINT = "reopens on reply";
export const SEND_LABEL = `Reply ${COMPOSER_PRIMARY_KEY}`;

export interface ThreadComposerProps {
  readonly threadId: string;
  /** Drives the hint: replying to a resolved thread reopens it, server-side. */
  readonly resolved: boolean;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ThreadComposer({
  threadId,
  resolved,
  onNotify,
}: ThreadComposerProps): ReactElement {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [asking, setAsking] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const intake = useAttachmentIntake();
  const append = useAppendTurn(threadId);
  /*
   * The weight, scoped to **this conversation** (SPEC.md §11's rider): two
   * columns showing the same thread show the same standing choice, exactly as
   * their collapse state agrees. Liveness follows the toggle beside it and
   * nothing else — flipping to `○ note only` dims the control and keeps the
   * choice, and the choice never touches the toggle in return.
   */
  const weight = useComposerWeight(threadWeightScope(threadId));
  // A reply lands in this thread, so this thread is where the scope walk starts.
  const recipient = useComposerRecipient({ start: threadId });
  const live = composerReachesAgent({ requestsAgent: asking });

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

  const trimmed = text.trim();
  const hasContent = trimmed !== "" || intake.pending.length > 0;
  const canSend = hasContent && !append.isPending;

  const send = useCallback(() => {
    if (!hasContent || append.isPending) return;
    const body = text.trim();
    const attachments: readonly PendingAttachment[] = intake.take();
    setText("");
    setCaret(0);
    append.mutate(
      {
        body,
        requestsAgent: asking,
        // Sent whatever the toggle says: liveness is a presentation rule, so a
        // note-only turn still states what it was asked at. Nothing enqueues, so
        // nothing reads it — and the composer said so before sending.
        ...weight.request,
        // `{}` unless a lane other than the computed default was picked — the
        // default travels by being absent, which is what stops the UI's rule and
        // the server's from ever disagreeing about it (SPEC.md §7).
        ...recipient.request,
        ...(attachments.length === 0
          ? {}
          : { files: attachments.map((attachment) => attachment.file) }),
      },
      {
        onSuccess: (result) => {
          // §7: an override "never persists past the message it was set on".
          recipient.clear();
          intake.release(attachments);
          // SPEC.md §14: a non-fatal problem "surfaces loudly". The turn landed
          // either way — files are the source of truth — so this is a notice
          // beside a success, not a failure.
          for (const warning of result.warnings) {
            onNotify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
          }
        },
        onError: (error) => {
          // Nothing was written — the server refuses the whole turn when the
          // upload fails — so the composer goes back to exactly what it held,
          // the recipient included. A refusal may *be* the lane (a `422` for a
          // scope dissolved between the roster read and the post), and that is
          // the one case where dropping the pick would do harm: the text comes
          // back, the person presses send again, and this build's own walk —
          // over the same stale roster that produced the pick — quietly routes
          // the retry somewhere they never addressed. `refuse` keeps the pick
          // for exactly that error and clears it for every other (UI-118).
          recipient.refuse(error);
          setText(body);
          setCaret(body.length);
          intake.restore(attachments);
          onNotify({ tone: "error", message: `Reply failed — ${error.message}` });
        },
      },
    );
  }, [append, asking, hasContent, intake, onNotify, recipient, text, weight.request]);

  return (
    <div
      // `in-use` is the half of "stays visible while you scroll" that CSS cannot
      // ask for: `:focus-within` covers a composer being typed in, but nothing
      // in CSS can ask whether a textarea holds text. Both halves are wanted —
      // focus is the case the issue was filed for, and an unsent draft is the
      // step after it, where you click into the document to check something and
      // scrolling would otherwise carry your half-written reply away (UI-110).
      className={["composer", intake.dropping ? "dropping" : "", hasContent ? "in-use" : ""]
        .filter(Boolean)
        .join(" ")}
      data-dropzone={threadId}
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
    >
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />

      <GrowingTextarea
        ref={input}
        value={text}
        placeholder={COMPOSER_PLACEHOLDER}
        aria-label="Reply"
        data-composer={threadId}
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

      <WeightPicker weight={weight} live={live} surface={threadId} />
      <RecipientPicker recipient={recipient} live={live} surface={threadId} />

      <div className="composer-foot">
        <AttachButton surface={threadId} onFiles={intake.add} />
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
        <span className="composer-hint">{resolved ? RESOLVED_HINT : OPEN_HINT}</span>
        <button type="button" className="send" disabled={!canSend} onClick={send}>
          {SEND_LABEL}
        </button>
      </div>

      <AutocompleteMenu
        open={autocomplete.isOpen}
        items={autocomplete.items}
        activeIndex={autocomplete.activeIndex}
        onHover={autocomplete.setActiveIndex}
        onChoose={autocomplete.choose}
        style={menuStyle}
        label="Reply completions"
      />
    </div>
  );
}
