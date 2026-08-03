import {
  AutocompleteMenu,
  COMPOSER_NEWLINE_HINT,
  COMPOSER_PRIMARY_KEY,
  COMPOSER_SECONDARY_KEY,
  handleComposerKeyDown,
  useAutocomplete,
  type RowNotice,
} from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { PendingAttachments } from "../thread/PendingAttachments";
import { useAttachmentIntake, type PendingAttachment } from "../thread/useAttachmentIntake";
import { useCompose, type ComposeMode } from "./useCompose";
import "./compose.css";

/**
 * The global composer (SPEC.md §11, `design/index.html`'s `#compose-overlay`):
 * one textarea, two submits, and the blank page the agent is reachable from.
 *
 * **It is the thread composer's units in a different chrome.** The `@` / `/`
 * `[[` completions are `@corpus/kit`'s, the three ways a file gets in are
 * `useAttachmentIntake`'s, and the chips are `PendingAttachments`. Nothing about
 * "typing at Corpus" is re-implemented here; what is new is only the routing
 * between Ask and Capture, which lives in `useCompose`.
 *
 * The panel carries `.overlay.open` — the class pair `isOverlayOpen()` queries.
 * A modal that manages its own visibility and skips them tells the shortcut
 * dispatcher the board still owns the keyboard, and `c` would then reopen the
 * composer from inside the composer.
 */

/**
 * The prototype's placeholder, character for character — **one attribute with an
 * embedded newline** (`design/index.html` writes it as `&#10;`), not two
 * elements. A separate hint line would need its own font, colour and spacing to
 * look like this, and would then be a second thing to keep matching the first.
 */
export const COMPOSE_PLACEHOLDER =
  "Ask the agent anything, or capture a thought…\n" +
  "@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files";

export const COMPOSE_HINT = `@ agents · / skills · [[ refs · ${COMPOSER_NEWLINE_HINT}`;
export const ASK_LABEL = `Ask ${COMPOSER_PRIMARY_KEY}`;
/**
 * Capture is the *secondary* submit, so it takes `⇧⌘↵` — SPEC.md §11's contract
 * gives `⌘↵` to the primary action in every composer, and here that is Ask. The
 * chord it used to own moved with the rule, not against it.
 */
export const CAPTURE_LABEL = `Capture ${COMPOSER_SECONDARY_KEY}`;

/** Why Capture can be unavailable while Ask is not: a document needs a body. */
export const CAPTURE_NEEDS_TEXT = "A capture becomes a document — it needs a line of text.";

export interface ComposeOverlayProps {
  readonly onClose: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ComposeOverlay({ onClose, onNotify }: ComposeOverlayProps): ReactElement {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const intake = useAttachmentIntake();
  const compose = useCompose(onNotify);

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  /**
   * Escape closes from anywhere *outside* the textarea through the one chain
   * (UI-005's layers, at overlay priority, over focus mode and the readers). The
   * chain deliberately ignores keys aimed at a writing surface, which is why the
   * panel below also handles Escape: with the caret in the textarea — where it
   * starts — the layer never sees the press.
   */
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Overlay, onEscape: onClose });

  const applyCompletion = useCallback((result: { text: string; caret: number }) => {
    setText(result.text);
    setCaret(result.caret);
    const element = textarea.current;
    if (element !== null) {
      element.value = result.text;
      element.setSelectionRange(result.caret, result.caret);
      element.focus();
    }
  }, []);

  const autocomplete = useAutocomplete({ value: text, caret, onComplete: applyCompletion });

  useLayoutEffect(() => {
    if (!autocomplete.isOpen || textarea.current === null) return;
    const rect = textarea.current.getBoundingClientRect();
    setMenuStyle({ top: rect.bottom + 4, left: rect.left });
  }, [autocomplete.isOpen, autocomplete.items.length]);

  const trimmed = text.trim();
  const canAsk = (trimmed !== "" || intake.pending.length > 0) && !compose.isPending;
  const canCapture = trimmed !== "" && !compose.isPending;

  const submit = useCallback(
    (mode: ComposeMode) => {
      if (mode === "ask" ? !canAsk : !canCapture) return;
      const body = text;
      const attachments: readonly PendingAttachment[] = intake.take();
      setText("");
      setCaret(0);
      void (async () => {
        const ok = await compose.submit(mode, {
          text: body,
          files: attachments.map((attachment) => attachment.file),
        });
        if (ok) {
          intake.release(attachments);
          onClose();
          return;
        }
        // Nothing is lost on a failure: the text and the chips come back and the
        // panel stays open, because the person still means to send this.
        setText(body);
        setCaret(body.length);
        intake.restore(attachments);
        textarea.current?.focus();
      })();
    },
    [canAsk, canCapture, compose, intake, onClose, text],
  );

  /**
   * The contract, and only the contract (SPEC.md §11): `↵` is a newline, `⌘↵`
   * asks, `⇧⌘↵` captures, `esc` closes, an IME commit does none of it, and an
   * open completion menu is asked first. Every one of those sentences used to be
   * written out here, and in four other composers, each slightly differently.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    handleComposerKeyDown(event, {
      claim: autocomplete.handleKeyDown,
      onPrimary: () => {
        submit("ask");
      },
      onSecondary: () => {
        submit("capture");
      },
      onEscape: onClose,
    });
  };

  return (
    <div
      className="overlay open"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className={
          intake.dropping ? "search-panel compose-panel dropping" : "search-panel compose-panel"
        }
        role="dialog"
        aria-modal="true"
        aria-label="Ask or capture"
        data-dropzone="compose"
        onDragEnter={intake.onDragEnter}
        onDragOver={intake.onDragOver}
        onDragLeave={intake.onDragLeave}
        onDrop={intake.onDrop}
      >
        <textarea
          ref={textarea}
          value={text}
          placeholder={COMPOSE_PLACEHOLDER}
          aria-label="Ask the agent, or capture a thought"
          data-composer="compose"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart);
          }}
          onPaste={intake.onPaste}
          onKeyDown={onKeyDown}
        />

        <PendingAttachments pending={intake.pending} onRemove={intake.remove} />

        <div className="compose-actions">
          <button
            type="button"
            className="clip"
            title="Attach files from disk"
            aria-label="Attach files"
            onClick={() => {
              picker.current?.click();
            }}
          >
            📎
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            data-attach-input="compose"
            onChange={(event) => {
              intake.add(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="hint">{COMPOSE_HINT}</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn-capture"
            disabled={!canCapture}
            title={canCapture ? "Save to inbox/ — the agent files it" : CAPTURE_NEEDS_TEXT}
            onClick={() => {
              submit("capture");
            }}
          >
            {CAPTURE_LABEL}
          </button>
          <button
            type="button"
            className="btn-ask"
            disabled={!canAsk}
            title="Start a standalone agent thread"
            onClick={() => {
              submit("ask");
            }}
          >
            {ASK_LABEL}
          </button>
        </div>

        <AutocompleteMenu
          open={autocomplete.isOpen}
          items={autocomplete.items}
          activeIndex={autocomplete.activeIndex}
          onHover={autocomplete.setActiveIndex}
          onChoose={autocomplete.choose}
          style={menuStyle}
          label="Composer completions"
        />
      </div>
    </div>
  );
}
