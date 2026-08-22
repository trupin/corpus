import {
  AttachButton,
  AutocompleteMenu,
  COMPOSER_PRIMARY_KEY,
  composerAddress,
  ComposerAddress,
  composerReachesAgent,
  handleComposerKeyDown,
  PendingAttachments,
  threadWeightScope,
  useAppendTurn,
  useAttachmentIntake,
  useAutocomplete,
  useComposerRecipient,
  useComposerWeight,
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
 * **Its keys are the kit's, not its own** (SPEC.md §10): `↵` is a newline and
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
   * The weight, scoped to **this conversation** (SPEC.md §10's rider): two
   * columns showing the same thread show the same standing choice, exactly as
   * their collapse state agrees. Liveness follows the toggle beside it and
   * nothing else, and the choice never touches the toggle in return.
   */
  const weight = useComposerWeight(threadWeightScope(threadId));
  // A reply lands in this thread, so this thread is where the scope walk starts.
  const recipient = useComposerRecipient({ start: threadId });
  /*
   * The address (UI-126): who answers, at what weight, as one line. What it
   * puts on the wire is `address.request` — the pick when one was made, and
   * the weight **only where a level was offered and chosen**: on the floor
   * (`○ note only`) nothing is weighed so nothing is stated, and for a
   * resident recipient the weight was set at designation, so a standing choice
   * is not sent rather than silently discarded (SPEC.md §7, rider signed
   * 2026-08-19).
   */
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
        // `{}` unless something was actually stated: a picked lane travels as
        // itself, an untouched default travels by being absent (SPEC.md §7),
        // and a weight rides only where the composer offered levels — see the
        // address derivation above for the two places it deliberately does not.
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
          // SPEC.md §11: a non-fatal problem "surfaces loudly". The turn landed
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
  }, [address.request, append, asking, hasContent, intake, onNotify, recipient, text]);

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

      <div className="composer-foot">
        <AttachButton surface={threadId} onFiles={intake.add} />
        <ComposerAddress address={address} surface={threadId} />
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
        {/* The hint is the item the foot truncates when it runs out of room
            (`thread.css`), and neither of these two sentences is said anywhere
            else in the product — so the whole of it rides on a `title`, which
            is SHARED-057 clause 2: truncation reveals rather than hides. */}
        <span className="composer-hint" title={resolved ? RESOLVED_HINT : OPEN_HINT}>
          {resolved ? RESOLVED_HINT : OPEN_HINT}
        </span>
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
