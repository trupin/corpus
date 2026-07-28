/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { MarkdownView } from "./MarkdownView.js";

afterEach(cleanup);

function docFixture(id: string, title: string): Doc {
  return {
    frontmatter: {
      id,
      type: "note",
      title,
      created: "2026-07-01T09:00:00.000Z",
      updated: "2026-07-01T09:00:00.000Z",
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra: {},
    },
    body: "",
    path: `data/docs/finance/${id}.md`,
    anchors: [],
  };
}

interface WireOptions {
  readonly docs?: Readonly<Record<string, string>>;
}

function wire(options: WireOptions = {}): {
  fetch: typeof globalThis.fetch;
  reads: string[];
} {
  const reads: string[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(new Request(input).url);
    reads.push(url.pathname);
    const id = url.pathname.slice("/api/docs/".length);
    const title = options.docs?.[id];
    const payload =
      title === undefined
        ? { code: "not_found", message: `no ${id}` }
        : (docFixture(id, title) as unknown);
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: title === undefined ? 404 : 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, reads };
}

describe("MarkdownView", () => {
  it("renders GFM tables and task lists", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(
      <MarkdownView
        markdown={"| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] open"}
        onOpenRef={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    expect(container.querySelectorAll("table th")).toHaveLength(2);
    expect(container.querySelectorAll("input[type='checkbox']")).toHaveLength(2);
  });

  /**
   * There is no sanitizer here to get wrong: `rehype-raw` is absent, so raw HTML
   * never becomes elements in the first place.
   */
  it("never injects raw HTML", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const { container } = render(
      <MarkdownView markdown={"<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"} />,
      { wrapper: harness.Wrapper },
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("renders a ref as the target's current title", async () => {
    const harness = createCorpusTestHarness({ fetch: wire({ docs: { doc_b: "Rates" } }).fetch });
    const { container } = render(<MarkdownView markdown="see [[doc_b]]" />, {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(container.querySelector(".ref")?.textContent).toBe("Rates");
    });
  });

  it("renders the alias, and still navigates to the id behind it", async () => {
    const opened: string[] = [];
    const harness = createCorpusTestHarness({ fetch: wire({ docs: { doc_b: "Rates" } }).fetch });
    render(
      <MarkdownView
        markdown="see [[doc_b|the rate assumption]]"
        onOpenRef={(id) => opened.push(id)}
      />,
      { wrapper: harness.Wrapper },
    );
    const link = await screen.findByText("the rate assumption");
    fireEvent.click(link);
    expect(opened).toEqual(["doc_b"]);
  });

  it("renders an unresolved ref visibly broken, and not as a link", async () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(<MarkdownView markdown="see [[doc_missing]]" />, {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(container.querySelector(".ref-broken")).not.toBeNull();
    });
    expect(container.querySelector(".ref-broken")?.tagName).toBe("SPAN");
    expect(container.querySelector("a.ref")).toBeNull();
    expect(container.querySelector(".ref-broken")?.getAttribute("title")).toContain(
      "does not exist yet",
    );
  });

  /**
   * The adjudicated strategy (`GET /api/docs` has no `ids=` filter): one
   * cache-deduped `useDoc` per **distinct** id, never one per occurrence.
   */
  it("resolves eight refs to three documents in three requests", async () => {
    const transport = wire({ docs: { doc_0: "Zero", doc_1: "One", doc_2: "Two" } });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const body = Array.from({ length: 8 }, (_, index) => `[[doc_${index % 3}]]`).join(" ");
    const { container } = render(<MarkdownView markdown={body} />, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(container.querySelectorAll(".ref")).toHaveLength(8);
    });
    await waitFor(() => {
      expect(container.querySelector(".ref")?.textContent).toBe("Zero");
    });
    expect(transport.reads.filter((path) => path.startsWith("/api/docs/"))).toHaveLength(3);
  });

  it("leaves ordinary links alone and opens them in a new tab", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(<MarkdownView markdown="[docs](https://example.com)" />, {
      wrapper: harness.Wrapper,
    });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.className).not.toContain("ref");
  });

  /**
   * The regression a real browser found: an unrelated re-render of the host
   * handed `react-markdown` a fresh `components` object, which replaced every
   * `<a>` in the body — and a click already in flight landed on a detached node.
   */
  it("keeps the rendered body's DOM nodes across a host re-render with a new callback", async () => {
    const opened: string[] = [];
    const harness = createCorpusTestHarness({ fetch: wire({ docs: { doc_b: "Rates" } }).fetch });
    const view = render(
      <MarkdownView markdown="see [[doc_b]]" onOpenRef={(id) => opened.push(id)} />,
      { wrapper: harness.Wrapper },
    );
    const before = await screen.findByText("Rates");

    view.rerender(<MarkdownView markdown="see [[doc_b]]" onOpenRef={(id) => opened.push(id)} />);
    const after = screen.getByText("Rates");
    expect(after).toBe(before);

    // …and the node still calls the *current* callback.
    fireEvent.click(after);
    expect(opened).toEqual(["doc_b"]);
  });

  it("takes the caller's class so a host can set its own measure", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(
      <MarkdownView markdown="hi" className="doc-body turn-markdown" />,
      {
        wrapper: harness.Wrapper,
      },
    );
    expect(container.querySelector(".turn-markdown")).not.toBeNull();
  });
});
