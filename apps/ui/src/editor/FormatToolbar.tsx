import { ALIGN_VALUES, INDENT_LEVELS, STYLE_ROLES, type StyleRole } from "@corpus/contract";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { HEADING_LEVELS, MARK, NODE } from "./markdown/schema.js";

/**
 * The persistent formatting toolbar (SPEC.md §10, rider signed 2026-08-12).
 *
 * *"The full-viewport surface carries a formatting toolbar that is always
 * present, above the document — the familiar shape of a document editor, and the
 * answer to formatting being discoverable today only by selecting text first."*
 *
 * **It reports state, which is the half that is easy to skip.** The rider is
 * explicit: *"the heading control names the current block's level, and an active
 * mark shows as active, so the toolbar says what the text already is and not
 * only what could be done to it."* So every control here reads the editor rather
 * than merely writing to it, and it re-reads on `transaction` as well as
 * `selectionUpdate` — a caret moved with an arrow key changes what the toolbar
 * must say, and only the first of those two events fires for it.
 *
 * **Its contents are bounded by what round-trips through the file.** Everything
 * offered below is a construct `markdown/schema.ts` can print and parse back.
 * Per-range font family and size, and any colour that is not one of §5's four
 * named roles, are deliberately absent — a control that wrote formatting the
 * file cannot carry would either put arbitrary HTML in a markdown document or do
 * nothing at all while appearing to work.
 *
 * **Undo and redo are absent by decision, not by omission** (SHARED-034's
 * sign-off): the editor has history and `⌘Z` works, so buttons would spend the
 * bar's room on the one thing nobody has to discover.
 *
 * **The selection toolbar is untouched.** It keeps **Comment**, which is not
 * formatting and belongs where the selection is (§6). The two never disagree
 * because both act on one document through one editor.
 *
 * **Column readers do not get this** (SHARED-034, again by decision): a
 * persistent bar costs vertical space a column cannot spare. It is rendered by
 * `FocusMode` and nowhere else.
 */

export interface FormatToolbarProps {
  /**
   * The live editor, or `null`.
   *
   * `null` is the whole gate. `DocView` mounts an editor only for a body it
   * edits — never for a `thread`, never for a `view`, never while the comments
   * list is showing — so a surface that is not the markdown editor publishes no
   * editor and this renders nothing. There is no second predicate here to keep
   * in step with `editorHandlesType`.
   */
  readonly editor: Editor | null;
}

/** The block the heading control names, and the value it reports. */
const PARAGRAPH_VALUE = "0";

/** How the four colour roles read in the menu. */
const ROLE_LABELS: Readonly<Record<StyleRole, string>> = {
  accent: "Accent",
  warning: "Warning",
  positive: "Positive",
  muted: "Muted",
};

const ALIGN_LABELS: Readonly<Record<string, string>> = {
  left: "Left",
  center: "Centre",
  right: "Right",
  justify: "Justify",
};

interface ToggleSpec {
  readonly name: string;
  readonly label: string;
  readonly glyph: ReactElement | string;
  readonly run: (editor: Editor) => void;
}

/** Marks, in the order the prototype's bar shows them. */
const MARK_BUTTONS: readonly ToggleSpec[] = [
  {
    name: MARK.bold,
    label: "Bold",
    glyph: <b>B</b>,
    run: (editor) => void editor.chain().focus().toggleBold().run(),
  },
  {
    name: MARK.italic,
    label: "Italic",
    glyph: <i>I</i>,
    run: (editor) => void editor.chain().focus().toggleItalic().run(),
  },
  {
    name: MARK.strike,
    label: "Strikethrough",
    glyph: <s>S</s>,
    run: (editor) => void editor.chain().focus().toggleStrike().run(),
  },
  {
    name: MARK.underline,
    label: "Underline",
    glyph: <u>U</u>,
    run: (editor) => void editor.chain().focus().toggleMark(MARK.underline).run(),
  },
  {
    name: MARK.highlight,
    label: "Highlight",
    glyph: "▮",
    run: (editor) => void editor.chain().focus().toggleMark(MARK.highlight).run(),
  },
  {
    name: MARK.code,
    label: "Inline code",
    glyph: "</>",
    run: (editor) => void editor.chain().focus().toggleCode().run(),
  },
];

/** Blocks that are a toggle rather than a choice. */
const BLOCK_BUTTONS: readonly ToggleSpec[] = [
  {
    name: NODE.bulletList,
    label: "Bulleted list",
    glyph: "•",
    run: (editor) => void editor.chain().focus().toggleBulletList().run(),
  },
  {
    name: NODE.orderedList,
    label: "Numbered list",
    glyph: "1.",
    run: (editor) => void editor.chain().focus().toggleOrderedList().run(),
  },
  {
    name: NODE.taskList,
    label: "Checklist",
    glyph: "☑",
    run: (editor) => void editor.chain().focus().toggleTaskList().run(),
  },
  {
    name: NODE.blockquote,
    label: "Quote",
    glyph: "❝",
    run: (editor) => void editor.chain().focus().toggleBlockquote().run(),
  },
  {
    name: NODE.codeBlock,
    label: "Code block",
    glyph: "▤",
    run: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
  },
];

/**
 * The level a menu value names, or `null` for Text.
 *
 * Narrowed by searching {@link HEADING_LEVELS} rather than cast: the command's
 * parameter is a union of six literals, and asserting a `number` into it would
 * be a claim about the `<option>` list that nothing checks. A value outside the
 * list is Text, which is the safe reading of an element somebody has tampered
 * with.
 */
function headingLevel(value: string): (typeof HEADING_LEVELS)[number] | null {
  return HEADING_LEVELS.find((level) => String(level) === value) ?? null;
}

/** The heading level the cursor is in, as the `<select>`'s value. */
export function headingValue(editor: Editor): string {
  for (const level of HEADING_LEVELS) {
    if (editor.isActive(NODE.heading, { level })) return String(level);
  }
  return PARAGRAPH_VALUE;
}

/** The colour role on the cursor, or `""` for none. */
export function roleValue(editor: Editor): string {
  const active = editor.getAttributes(MARK.styleSpan);
  const color: unknown = active["color"];
  return typeof color === "string" && (STYLE_ROLES as readonly string[]).includes(color)
    ? color
    : "";
}

/** The styled block's alignment, or `""` when the cursor is in no styled block. */
export function alignValue(editor: Editor): string {
  const active = editor.getAttributes(NODE.styledBlock);
  const align: unknown = active["align"];
  return typeof align === "string" ? align : "";
}

/** The styled block's indent level, or `""`. */
export function indentValue(editor: Editor): string {
  const active = editor.getAttributes(NODE.styledBlock);
  const indent: unknown = active["indent"];
  return typeof indent === "number" ? String(indent) : "";
}

/**
 * Applies one layout property to the block at the cursor.
 *
 * Three cases, and the third is the one that is easy to get wrong: clearing the
 * *last* property a styled block carries must remove the block, not leave an
 * empty `::: {}` the file cannot even spell.
 */
function setLayout(editor: Editor, patch: { align?: string | null; indent?: number | null }): void {
  const inBlock = editor.isActive(NODE.styledBlock);
  const current = editor.getAttributes(NODE.styledBlock);
  const align =
    patch.align === undefined ? ((current["align"] as string | null) ?? null) : patch.align;
  const indent =
    patch.indent === undefined ? ((current["indent"] as number | null) ?? null) : patch.indent;

  if (align === null && indent === null) {
    if (inBlock) void editor.chain().focus().lift(NODE.styledBlock).run();
    return;
  }
  if (inBlock) {
    void editor.chain().focus().updateAttributes(NODE.styledBlock, { align, indent }).run();
    return;
  }
  void editor.chain().focus().wrapIn(NODE.styledBlock, { align, indent }).run();
}

export function FormatToolbar({ editor }: FormatToolbarProps): ReactElement | null {
  const [, bump] = useState(0);
  /**
   * The last range the document actually had selected.
   *
   * A `<select>` cannot have its `mousedown` cancelled — cancelling it is what
   * stops the menu from opening at all — so using one takes focus off the
   * editor, the browser collapses the selection and ProseMirror adopts the
   * collapse. By the time `change` fires the words the user had selected are no
   * longer selected, and a mark command would apply to an empty caret.
   *
   * Mirroring the selection as it changes is what survives **every** way of
   * reaching the control. Capturing it on `mousedown` would not: a keyboard user
   * tabs to the select and changes it with the arrow keys, and no pointer event
   * happens at all.
   */
  const held = useRef<{ from: number; to: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [imageValue, setImageValue] = useState("");

  useEffect(() => {
    if (editor === null) return undefined;
    const update = (): void => {
      const { from, to, empty } = editor.state.selection;
      if (!empty) held.current = { from, to };
      bump((count) => count + 1);
    };
    /*
     * `transaction` alone, and that is a correction rather than a shortcut.
     *
     * This subscribed to `selectionUpdate` as well, on the reasoning that a
     * caret moved with an arrow key changes what the bar must say and only that
     * event reports it. Breaking the code proved the reasoning wrong: with
     * `selectionUpdate` removed, every browser assertion still passed, because
     * a selection change **is** a transaction and TipTap fires `transaction`
     * for it. The second subscription was doing nothing but making a claim.
     */
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  if (editor === null) return null;

  const closePopovers = (): void => {
    setLinkOpen(false);
    setImageOpen(false);
  };

  /**
   * Runs a command over the selection the document had, not the one a focused
   * control left behind.
   *
   * Restores only when focus has actually left the editor. A caret the user
   * deliberately collapsed *inside* the document is a real selection, and
   * reviving an older range over it would apply a mark to words they had moved
   * away from.
   */
  const withSelection = (run: (target: Editor) => void): void => {
    const saved = held.current;
    if (!editor.isFocused && saved !== null) {
      editor.chain().focus().setTextSelection(saved).run();
    }
    run(editor);
  };

  const toggleButton = (spec: ToggleSpec): ReactElement => {
    const on = editor.isActive(spec.name);
    return (
      <button
        key={spec.name}
        type="button"
        data-fmt={spec.name}
        title={spec.label}
        aria-label={spec.label}
        aria-pressed={on}
        className={on ? "on" : undefined}
        onClick={() => {
          closePopovers();
          withSelection(spec.run);
        }}
      >
        {spec.glyph}
      </button>
    );
  };

  return (
    <div
      className="fmt-bar"
      role="toolbar"
      aria-label="Formatting"
      data-fmt-bar
      // The caret must not move because a button was pressed. `mousedown` is
      // what would take focus off the editor, so it never completes here; the
      // command's own `.focus()` then puts the caret back exactly where the user
      // left it.
      onMouseDown={(event) => {
        // A `select` and an `input` must receive their own mousedown or they
        // cannot be opened or typed into; everything else is cancelled so the
        // caret never leaves the document in the first place.
        if ((event.target as HTMLElement).closest("select, input") === null) {
          event.preventDefault();
        }
      }}
    >
      <div className="fmt-group">
        <select
          data-fmt="block"
          aria-label="Block style"
          value={headingValue(editor)}
          onChange={(event) => {
            closePopovers();
            const level = headingLevel(event.target.value);
            withSelection((target) => {
              if (level === null) void target.chain().focus().setParagraph().run();
              else void target.chain().focus().setHeading({ level }).run();
            });
          }}
        >
          <option value={PARAGRAPH_VALUE}>Text</option>
          {HEADING_LEVELS.map((level) => (
            <option key={level} value={String(level)}>
              Heading {level}
            </option>
          ))}
        </select>
      </div>

      <span className="fmt-divider" />

      <div className="fmt-group">
        {MARK_BUTTONS.map(toggleButton)}
        <select
          data-fmt="color"
          aria-label="Text colour"
          value={roleValue(editor)}
          onChange={(event) => {
            closePopovers();
            const role = event.target.value;
            withSelection((target) => {
              if (role === "") void target.chain().focus().unsetMark(MARK.styleSpan).run();
              else void target.chain().focus().setMark(MARK.styleSpan, { color: role }).run();
            });
          }}
        >
          <option value="">Colour</option>
          {STYLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      <span className="fmt-divider" />

      <div className="fmt-group">{BLOCK_BUTTONS.map(toggleButton)}</div>

      <span className="fmt-divider" />

      <div className="fmt-group">
        <select
          data-fmt="align"
          aria-label="Alignment"
          value={alignValue(editor)}
          onChange={(event) => {
            closePopovers();
            const value = event.target.value;
            withSelection((target) => {
              setLayout(target, { align: value === "" ? null : value });
            });
          }}
        >
          <option value="">Align</option>
          {ALIGN_VALUES.map((value) => (
            <option key={value} value={value}>
              {ALIGN_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          data-fmt="indent"
          aria-label="Indent"
          value={indentValue(editor)}
          onChange={(event) => {
            closePopovers();
            const value = event.target.value;
            withSelection((target) => {
              setLayout(target, { indent: value === "" ? null : Number(value) });
            });
          }}
        >
          <option value="">Indent</option>
          {INDENT_LEVELS.map((level) => (
            <option key={level} value={String(level)}>
              {level}
            </option>
          ))}
        </select>
      </div>

      <span className="fmt-divider" />

      <div className="fmt-group">
        <button
          type="button"
          data-fmt="link"
          title="Link"
          aria-label="Link"
          aria-pressed={editor.isActive(MARK.link)}
          className={editor.isActive(MARK.link) ? "on" : undefined}
          onClick={() => {
            setImageOpen(false);
            if (editor.isActive(MARK.link)) {
              // The ordinary gesture is a caret *inside* a link rather than a
              // selection over one, and `unsetLink` already handles it: TipTap's
              // command is `unsetMark(name, { extendEmptyMarkRange: true })`.
              // Extending the range here as well was written, and removed — it
              // changed nothing, and the comment justifying it was wrong.
              void editor.chain().focus().unsetLink().run();
              setLinkOpen(false);
              return;
            }
            const href: unknown = editor.getAttributes(MARK.link)["href"];
            setLinkValue(typeof href === "string" ? href : "");
            setLinkOpen((open) => !open);
          }}
        >
          🔗
        </button>
        <button
          type="button"
          data-fmt="image"
          title="Image"
          aria-label="Image"
          onClick={() => {
            setLinkOpen(false);
            setImageValue("");
            setImageOpen((open) => !open);
          }}
        >
          🖼
        </button>
        <button
          type="button"
          data-fmt="table"
          title="Table"
          aria-label="Table"
          onClick={() => {
            closePopovers();
            void editor
              .chain()
              .focus()
              .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
              .run();
          }}
        >
          ▦
        </button>
        <button
          type="button"
          data-fmt="rule"
          title="Divider"
          aria-label="Divider"
          onClick={() => {
            closePopovers();
            void editor.chain().focus().setHorizontalRule().run();
          }}
        >
          —
        </button>
        <button
          type="button"
          data-fmt="clear"
          title="Clear formatting"
          aria-label="Clear formatting"
          onClick={() => {
            closePopovers();
            // Marks only. Clearing the *nodes* as well would turn a heading the
            // user was standing in into a paragraph, which is not what "clear
            // formatting" means to anyone reading a document.
            void editor.chain().focus().unsetAllMarks().run();
          }}
        >
          ⌫
        </button>
      </div>

      {linkOpen ? (
        <div className="fmt-link">
          <input
            type="url"
            aria-label="Link address"
            data-fmt-link-input
            value={linkValue}
            placeholder="https://…"
            onChange={(event) => {
              setLinkValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const href = linkValue.trim();
              if (href !== "") void editor.chain().focus().setLink({ href }).run();
              setLinkOpen(false);
            }}
          />
        </div>
      ) : null}

      {imageOpen ? (
        <div className="fmt-link">
          <input
            type="url"
            aria-label="Image address"
            data-fmt-image-input
            value={imageValue}
            placeholder="https://…"
            onChange={(event) => {
              setImageValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const src = imageValue.trim();
              if (src !== "") void editor.chain().focus().setImage({ src }).run();
              setImageOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
