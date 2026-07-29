import type { DocViewProps } from "@corpus/kit/plugin";
import { MarkdownView } from "@corpus/kit";
import { createElement, type ReactElement } from "react";

/**
 * The fixture's document `View`: replaces the standard document view for
 * `fixture-note` documents. Deliberately thin — a heading strip proving the
 * plugin renderer ran, over the kit's own markdown renderer. `createElement`
 * rather than JSX so the file stays `.ts` and the fixture needs no JSX build
 * step anywhere.
 */
export function FixtureView({ doc }: DocViewProps): ReactElement {
  return createElement(
    "div",
    { className: "fixture-view", "data-fixture-view": doc.frontmatter.id },
    createElement(
      "p",
      { className: "fixture-view-badge" },
      `Rendered by the _fixture plugin — ${doc.frontmatter.title}`,
    ),
    createElement(MarkdownView, { markdown: doc.body, className: "doc-body" }),
  );
}
