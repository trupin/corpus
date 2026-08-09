import { canonicalizeMarkdown } from "./markdown/serialize.js";

/**
 * The text the editor parses out of a body the server holds — and therefore the
 * text every ProseMirror position in a `DocEditor` is a position into.
 *
 * **This exists to be the one expression, named once and called twice.** Two
 * places have to agree about it and they are in different modules:
 * `DocEditor` builds its document with `parseMarkdown(editorBody(body))`, and
 * the anchor layer computes the trace it maps the server's offsets through with
 * `traceOfBody(editorBody(body))` — so the layer holds
 * `serialize(parse(editorBody(body)))` and the editor prints
 * `serialize(parse(editorBody(body)))`, the same expression on both sides.
 *
 * They used to be two expressions written independently: the editor parsed
 * `canonicalizeMarkdown(body)` while the layer traced `body`. That is a
 * difference only where `canonicalizeMarkdown` is not idempotent — printing a
 * file once and printing it twice give different text — which is rare enough
 * that it held for months and false enough to ship two defects on the documents
 * where it fails (UI-099: no highlight was ever drawn, and the selector quoted
 * the printer's spelling rather than the file's, which is UI-068 all over
 * again). The serializer's infidelity is UI-103's to fix; the two call sites
 * agreeing is this function's, and it holds whether or not that one is fixed.
 *
 * The agreement is **checked**, not merely intended: `DocEditor.test.tsx`
 * asserts that a real mounted editor's own document prints exactly
 * `editorBody(body)` on the construct where the two used to part company. A
 * future `DocEditor` that parsed something else would have to change that test
 * to go green.
 */
export function editorBody(body: string): string {
  return canonicalizeMarkdown(body);
}
