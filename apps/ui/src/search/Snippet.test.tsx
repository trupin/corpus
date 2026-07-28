/** @vitest-environment jsdom */
import type { Snippet as SnippetData } from "@corpus/contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { primarySnippet, Snippet } from "./Snippet";

afterEach(cleanup);

const snippet = (segments: SnippetData["segments"]): SnippetData => ({ field: "body", segments });

describe("Snippet", () => {
  it("renders matched runs as `<mark>` elements and the rest as text", () => {
    const { container } = render(
      <Snippet
        snippet={snippet([
          { text: "…the base case assumes a 30-year fixed; the ", match: false },
          { text: "mortgage", match: true },
          { text: " insurance question is threaded inline…", match: false },
        ])}
      />,
    );

    const marks = container.querySelectorAll(".sr-snippet mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("mortgage");
    expect(container.querySelector(".sr-snippet")?.textContent).toBe(
      "…the base case assumes a 30-year fixed; the mortgage insurance question is threaded inline…",
    );
  });

  it("renders text that looks like markup as text — there is no HTML path here", () => {
    const { container } = render(
      <Snippet
        snippet={snippet([
          { text: "<script>alert(1)</script> and <img src=x onerror=alert(1)> ", match: false },
          { text: "mortgage", match: true },
        ])}
      />,
    );

    const pane = container.querySelector(".sr-snippet");
    expect(pane?.textContent).toContain("<script>alert(1)</script>");
    expect(pane?.textContent).toContain("<img src=x onerror=alert(1)>");
    // Nothing was parsed as markup: the only element inside is the highlight.
    expect(pane?.querySelectorAll("script").length).toBe(0);
    expect(pane?.querySelectorAll("img").length).toBe(0);
    expect(pane?.children.length).toBe(1);
    expect(pane?.children[0]?.tagName).toBe("MARK");
  });

  it("renders a highlight-only snippet, and an empty one, without throwing", () => {
    const { container } = render(<Snippet snippet={snippet([{ text: "rates", match: true }])} />);
    expect(container.querySelector("mark")?.textContent).toBe("rates");

    cleanup();
    const empty = render(<Snippet snippet={snippet([])} />);
    expect(empty.container.querySelector(".sr-snippet")?.textContent).toBe("");
  });
});

describe("primarySnippet", () => {
  const title: SnippetData = { field: "title", segments: [{ text: "Mortgage", match: true }] };
  const body: SnippetData = { field: "body", segments: [{ text: "…rates…", match: false }] };

  it("prefers a body or turn excerpt over a title the row already shows in full", () => {
    expect(primarySnippet([title, body])).toBe(body);
  });

  it("falls back to the title match when that is all there is", () => {
    expect(primarySnippet([title])).toBe(title);
  });

  it("is null without `q`, when the server sends no snippets at all", () => {
    expect(primarySnippet([])).toBeNull();
  });
});
