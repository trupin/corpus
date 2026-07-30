import type { DocPanelProps } from "@corpus/kit/plugin";
import { createElement, type ReactElement } from "react";

/**
 * The fixture's `DocPanel` — the one core injection slot in v1 (SPEC.md §10),
 * rendered in a fixed spot above the document body in both the column reader
 * and focus mode. Shows a trivial derived stat (body length) so the panel
 * visibly depends on the document it sits above.
 */
export function FixtureDocPanel({ doc }: DocPanelProps): ReactElement {
  return createElement(
    "div",
    { className: "fixture-doc-panel", "data-fixture-panel": doc.frontmatter.id, role: "note" },
    `Fixture panel — ${String(doc.body.length)} characters`,
  );
}
