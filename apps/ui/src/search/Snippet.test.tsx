/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { highlight, Snippet } from "./Snippet";

afterEach(cleanup);

describe("Snippet", () => {
  it("renders the query's words as `<mark>` elements and the rest as text", () => {
    const { container } = render(
      <Snippet
        snippet="the base case assumes a 30-year fixed; the mortgage insurance question"
        query="mortgage"
      />,
    );

    const marks = container.querySelectorAll(".sr-snippet mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("mortgage");
    expect(container.querySelector(".sr-snippet")?.textContent).toBe(
      "the base case assumes a 30-year fixed; the mortgage insurance question",
    );
  });

  it("renders a snippet that looks like markup as text — there is no HTML path here", () => {
    const { container } = render(
      <Snippet
        snippet="<script>alert(1)</script> and <img src=x onerror=alert(1)>"
        query="alert"
      />,
    );

    const pane = container.querySelector(".sr-snippet");
    expect(pane?.textContent).toContain("<script>alert(1)</script>");
    expect(pane?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(pane?.querySelectorAll("script").length).toBe(0);
    expect(pane?.querySelectorAll("img").length).toBe(0);
    // Only the marks React created are elements; everything else is a text node.
    expect([...(pane?.children ?? [])].every((node) => node.tagName === "MARK")).toBe(true);
  });

  it("renders an empty snippet, and one nothing matched, without throwing", () => {
    const { container } = render(<Snippet snippet="" query="mortgage" />);
    expect(container.querySelector(".sr-snippet")?.textContent).toBe("");

    cleanup();
    const unmatched = render(<Snippet snippet="rates and terms" query="mortgage" />);
    expect(unmatched.container.querySelector("mark")).toBeNull();
    expect(unmatched.container.querySelector(".sr-snippet")?.textContent).toBe("rates and terms");
  });
});

describe("highlight", () => {
  const marked = (text: string, query: string): readonly string[] =>
    highlight(text, query)
      .filter((segment) => segment.match)
      .map((segment) => segment.text);

  it("marks every occurrence, case-insensitively, without changing the text", () => {
    const segments = highlight("Mortgage rates; the mortgage question", "mortgage");
    expect(marked("Mortgage rates; the mortgage question", "mortgage")).toEqual([
      "Mortgage",
      "mortgage",
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Mortgage rates; the mortgage question",
    );
  });

  it("marks each word of a multi-word query independently", () => {
    expect(marked("the mortgage rate assumption", "mortgage rate")).toEqual(["mortgage", "rate"]);
  });

  it("prefers the longer term where two overlap, leaving no stray fragment", () => {
    // `rate` sits inside `rates`; the longer word claims the region whole.
    expect(marked("fixed rates today", "rate rates")).toEqual(["rates"]);
  });

  it("marks nothing for an empty query, and returns the text as one run", () => {
    expect(highlight("rates and terms", "   ")).toEqual([
      { text: "rates and terms", match: false },
    ]);
    expect(highlight("", "mortgage")).toEqual([{ text: "", match: false }]);
  });

  it("never reorders or drops a character of the snippet", () => {
    const text = "…a 30-year fixed; MORTGAGE insurance & <b> stay as typed…";
    expect(
      highlight(text, "mortgage b")
        .map((segment) => segment.text)
        .join(""),
    ).toBe(text);
  });
});
