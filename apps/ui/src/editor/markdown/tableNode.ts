import { Table } from "@tiptap/extension-table";

/**
 * GFM's table, plus the one thing ProseMirror's table model has no room for:
 * **column alignment**.
 *
 * `| :-- | --: |` is content, not decoration — it is in the file, a reader sees
 * it, and an editor that dropped it would rewrite a table the user never
 * touched into a left-aligned one on the next unrelated save. `prosemirror-tables`
 * models spans and widths and nothing about alignment, so it rides on the table
 * node as the mdast array it came from and goes back out unchanged.
 */
export const CorpusTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        // Never rendered to the DOM: alignment is restored on serialisation
        // from this attribute, and a `data-` attribute here would only give the
        // HTML paste path a second, disagreeing source for it.
        rendered: false,
      },
    };
  },
});
