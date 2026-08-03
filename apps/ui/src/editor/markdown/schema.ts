import { getSchema, type Extensions } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import type { Schema } from "@tiptap/pm/model";
import { DocRef } from "./refNode.js";
import { RawBlock, RawInline } from "./rawNodes.js";
import { CorpusTable } from "./tableNode.js";

/**
 * **The** document schema — one extension list, read by the parser, the
 * serializer and the live editor.
 *
 * SPEC.md §5 makes the markdown file on disk the source of truth, so the round
 * trip through this schema has to be lossless: anything the schema cannot name
 * is a construct the editor would silently delete the first time a user fixed a
 * typo three paragraphs away. That is why {@link RawBlock} and
 * {@link RawInline} exist — every mdast node with no rich counterpart survives
 * as its own source text rather than as nothing.
 *
 * Sharing one list is the point (sprint-011 TEST-9): `parse.ts` and
 * `serialize.ts` both import this module, so the two directions cannot describe
 * different documents. Two hand-kept lists that happen to agree today are a
 * silent data-loss bug tomorrow.
 *
 * The `[[ref]]` node ships **without** its React view here ({@link DocRef} is
 * schema only) because parsing and serialising a document must not require a
 * DOM, a query cache or a mounted React tree. `DocEditor` extends it with the
 * view; the schema either way is identical, which is what keeps a document
 * parsed on the server-ish path and a document typed in the browser the same
 * document.
 */

/**
 * Headings the editor renders. `#`–`######`: the markdown file may legitimately
 * contain any of them (an agent writing a long note reaches for `#####`), and a
 * level the schema refuses is a level the editor would flatten into a paragraph
 * on the next save.
 */
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/**
 * The image node's configuration, named once.
 *
 * **Inline**, because markdown's `![alt](src)` is phrasing content: a block
 * image could not live inside a paragraph, so every inline image in an existing
 * document would be relocated on the first save.
 *
 * It is a constant rather than an inline literal because `DocEditor` swaps this
 * node for one carrying a React view (`ImageNodeView`, UI-049) and the two must
 * configure the *same* node — a view-only difference, exactly as `DocRef` and
 * `docRefWithView` are. Two literals that happen to agree today are a schema
 * fork tomorrow.
 */
export const IMAGE_OPTIONS = { inline: true, allowBase64: true } as const;

/**
 * The extension list, in one call so the schema cannot be built twice from two
 * different configurations.
 *
 * `history` stays on: undo is the user's only defence against an editor that is
 * always saving, and SPEC.md §11's "no edit mode" makes ⌘Z the whole safety
 * story. Autosave never dispatches a transaction (see `useAutosave`), so a save
 * landing mid-sequence cannot truncate the stack.
 */
export function corpusExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      // The prototype's `.doc-body` styling keys off plain element selectors,
      // so no extension contributes classes of its own.
      codeBlock: { exitOnTripleEnter: true, exitOnArrowDown: true },
      // `Link` is configured separately below; StarterKit v2 ships none.
    }),
    Link.configure({
      // A document body is prose, not a browser: following a link is the
      // reader's act, and a click that navigated away mid-edit would discard a
      // debounce window's worth of typing.
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
    }),
    Image.configure(IMAGE_OPTIONS),
    TaskList,
    TaskItem.configure({ nested: true }),
    CorpusTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    DocRef,
    RawBlock,
    RawInline,
  ];
}

/**
 * The ProseMirror schema those extensions describe.
 *
 * Built once and memoised: `getSchema` walks every extension, and the parser
 * calls it per document. Rebuilding it per parse would also make two documents
 * carry two schema instances, which ProseMirror treats as incompatible.
 */
let cached: Schema | undefined;

export function corpusSchema(): Schema {
  cached ??= getSchema(corpusExtensions());
  return cached;
}

/** Node and mark names the walks key on, spelled once. */
export const NODE = {
  doc: "doc",
  paragraph: "paragraph",
  text: "text",
  heading: "heading",
  bulletList: "bulletList",
  orderedList: "orderedList",
  listItem: "listItem",
  taskList: "taskList",
  taskItem: "taskItem",
  codeBlock: "codeBlock",
  blockquote: "blockquote",
  horizontalRule: "horizontalRule",
  hardBreak: "hardBreak",
  image: "image",
  table: "table",
  tableRow: "tableRow",
  tableCell: "tableCell",
  tableHeader: "tableHeader",
  docRef: "docRef",
  rawBlock: "rawBlock",
  rawInline: "rawInline",
} as const;

export const MARK = {
  bold: "bold",
  italic: "italic",
  code: "code",
  strike: "strike",
  link: "link",
} as const;

/**
 * The ProseMirror JSON shapes the two walks exchange.
 *
 * Declared structurally rather than imported from `prosemirror-model`: the
 * walks never hold a live `Node`, only the JSON both TipTap and the serializer
 * speak, and depending on the model's class types would make every helper take
 * a schema it does not need.
 */
export interface PmMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
}

export interface PmNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  readonly content?: readonly PmNode[] | undefined;
  readonly marks?: readonly PmMark[] | undefined;
  readonly text?: string | undefined;
}
