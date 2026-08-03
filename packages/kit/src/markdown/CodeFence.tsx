import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from "react";
import type { ExtraProps } from "react-markdown";

/**
 * A fenced block, rendered as a **copyable canvas** (SPEC.md §11, rider signed
 * 2026-08-02): the fence's raw text is one click away, and the fence's info
 * string — ```` ```prompt ```` — is drawn as the block's label.
 *
 * This is a read-surface affordance and lives with `MarkdownView`, which is the
 * only renderer that emits a `pre` in Corpus. The editable document body is
 * TipTap's contenteditable and is deliberately untouched: a caret sitting in a
 * code block already has the text selected the ordinary way, and a button
 * overlaying editable content is a click that steals a caret.
 *
 * **Raw text, not rendered text.** The bytes copied are the fence's own, read
 * back off the hast tree rather than off the DOM: no fence markers, no info
 * string, and no label — a `prompt` block pastes into another agent's input
 * exactly as its author wrote it.
 */

/** What the button says, and how long it says it for. */
type CopyState = "idle" | "copied" | "failed";

/** Long enough to read, short enough that a second copy is never blocked on it. */
const COPIED_MS = 1400;
/** A failure is a sentence to read, not a flash. */
const FAILED_MS = 4000;

export type CodeFenceProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;

type FenceNode = NonNullable<ExtraProps["node"]>;
type FenceChild = FenceNode["children"][number];

/** The `language-…` class `mdast-util-to-hast` writes for an info string. */
const LANGUAGE_PREFIX = "language-";

/**
 * The fence's raw text.
 *
 * `mdast-util-to-hast` renders a code node's value **plus one newline** ("a\nb"
 * becomes the text "a\nb\n"), which is a serialisation artifact of `<pre>` and
 * not a character the author typed. Exactly one trailing newline is therefore
 * dropped, and only one: a fence whose last line is deliberately blank keeps
 * that blank line, because its value already ends in "\n" and gains a second.
 *
 * The walk is depth-first over text nodes rather than a read of the single text
 * child the pipeline emits today — a fence is one text node only for as long as
 * nothing (a highlighter, `remarkCorpusRefs`' sibling) ever splits it, and a
 * copy button that silently truncates is worse than no copy button.
 */
function fenceText(node: FenceChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(fenceText).join("");
  return "";
}

/** The info string, when the fence carried one; `null` for a bare fence. */
function fenceLabel(code: FenceNode): string | null {
  const className = code.properties["className"];
  const classes = Array.isArray(className) ? className : [];
  for (const entry of classes) {
    if (typeof entry === "string" && entry.startsWith(LANGUAGE_PREFIX)) {
      const label = entry.slice(LANGUAGE_PREFIX.length);
      if (label !== "") return label;
    }
  }
  return null;
}

/**
 * The single `code` element a fenced block renders into, if this is one.
 *
 * `mdast-util-to-hast` gives a `pre` exactly one child and it is always that
 * `code`; anything else is a `pre` this component did not build and must not
 * decorate with a button claiming to copy it.
 */
function fenceCode(node: FenceNode | undefined): FenceNode | null {
  const only = node?.children.length === 1 ? node.children[0] : undefined;
  if (only === undefined || only.type !== "element" || only.tagName !== "code") return null;
  return only;
}

/**
 * The refusal, in the app's own sentence — the same shape `SelectionMenuItems`
 * uses, because a denied clipboard is one failure with one wording.
 */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : "the browser refused it";
  return message.replace(/\.\s*$/, "");
}

const NO_CLIPBOARD = "this browser gives the page no clipboard access";

/** What a fence needs of `navigator.clipboard`, and nothing more. */
interface FenceClipboard {
  writeText(text: string): Promise<void>;
}

export function CodeFence({ node, children, ...rest }: CodeFenceProps): ReactElement {
  const code = fenceCode(node);
  const [state, setState] = useState<CopyState>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const settle = useCallback((next: CopyState, ms: number): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setState("idle");
      setFailure(null);
    }, ms);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      // Read at click time, never at render: a page that is not a secure context
      // has no `navigator.clipboard` at all, and that must be *reported* rather
      // than turned into a button that quietly does nothing.
      const clipboard: FenceClipboard | null = globalThis.navigator?.clipboard ?? null;
      if (clipboard === null) {
        setFailure(NO_CLIPBOARD);
        settle("failed", FAILED_MS);
        return;
      }
      try {
        await clipboard.writeText(text);
        setFailure(null);
        settle("copied", COPIED_MS);
      } catch (error) {
        setFailure(reason(error));
        settle("failed", FAILED_MS);
      }
    },
    [settle],
  );

  const pre = <pre {...rest}>{children}</pre>;
  // Not a fenced block (nothing in the pipeline emits one today, but a `pre`
  // whose text cannot be read must not grow a button that copies the wrong
  // thing).
  if (code === null) return pre;

  const label = fenceLabel(code);
  const subject = label === null ? "code block" : `${label} block`;

  return (
    <div className="fence" data-fence>
      {label === null ? null : (
        <span className="fence-label" data-fence-label={label}>
          {label}
        </span>
      )}
      <div className="fence-canvas">
        {pre}
        <button
          type="button"
          data-fence-copy
          className={state === "idle" ? "fence-copy" : `fence-copy ${state}`}
          aria-live="polite"
          aria-label={ariaLabel(state, subject, failure)}
          title={state === "failed" && failure !== null ? `Could not copy — ${failure}` : undefined}
          onClick={() => {
            // Voided deliberately: the outcome is the button's own state, and
            // nothing upstream awaits a copy.
            void copy(stripOneNewline(fenceText(code)));
          }}
          onKeyDown={(event) => {
            /*
             * `↵` and `space` are a button's own activation keys, and this
             * button has to say so out loud: a host may bind them globally —
             * `apps/ui` binds `↵` to "open the highlighted document" on a
             * document-level listener that calls `preventDefault()` (SPEC.md
             * §11's keyboard scheme) — and a cancelled keydown never becomes
             * the click a keyboard user is owed. Observed in a real browser:
             * focus the button, press `↵`, nothing is copied.
             *
             * Stopped, never prevented. The native activation is left to
             * proceed, and the host's shortcut keeps working everywhere the
             * focus is not on this control.
             */
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * The button's accessible name carries its state, because the state *is* the
 * feedback: with `aria-live` on the button, a name that never changed would
 * announce nothing when the copy succeeded or was refused.
 */
function ariaLabel(state: CopyState, subject: string, failure: string | null): string {
  if (state === "copied") return `Copied the ${subject} to the clipboard`;
  if (state === "failed") {
    return `Could not copy the ${subject} — ${failure ?? "the browser refused it"}`;
  }
  return `Copy the ${subject}`;
}

/** See {@link fenceText}: one trailing newline, and never more than one. */
function stripOneNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
