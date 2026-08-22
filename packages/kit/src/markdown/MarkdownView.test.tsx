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
      origin: null,
      pinned: false,
      order: null,
      query: null,
      extra: {},
    },
    body: "",
    path: `data/docs/finance/${id}.md`,
    anchors: [],
    // SPEC.md §7: every document read carries its key and the advisory
    // "someone is editing this" signal. Neither is optional on the wire, so
    // neither is optional in a fixture.
    key: "0".repeat(64),
    userEditing: false,
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
   * sprint-010 FIND-3: `[[doc_notyet]]` is a *reference to a document that does
   * not exist yet* and gets the broken treatment; `[[not-a-real-doc]]` is not a
   * reference at all. It used to render as an enabled `<a class="ref">` that
   * navigated a reader to an id no document can ever have.
   */
  it("renders a non-id token as the literal text the author typed", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { container } = render(
      <MarkdownView
        markdown="see [[not-a-real-doc]] and [[not an id]]"
        onOpenRef={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    await waitFor(() => {
      expect(container.textContent).toContain("[[not-a-real-doc]]");
    });
    expect(container.textContent).toContain("[[not an id]]");
    expect(container.querySelector("a.ref")).toBeNull();
    expect(container.querySelector(".ref-broken")).toBeNull();
    // And nothing was looked up: there is no id to look up.
    expect(transport.reads.filter((path) => path.startsWith("/api/docs/"))).toHaveLength(0);
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

  /**
   * UI-049's regression. An attachment referenced at the *end* of a turn always
   * rendered — the thread fetched it with the bearer token — while the same
   * reference one line earlier went through here as a bare relative `src` and
   * loaded nothing at all. The override is what makes the two the same picture.
   */
  it("routes a mid-prose attachment reference through the authenticated fetch", async () => {
    const reads: string[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      reads.push(
        `${new URL(request.url).pathname} auth=${request.headers.get("authorization") ?? ""}`,
      );
      return Promise.resolve(new Response(new Blob(["png"]), { status: 200 }));
    };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:md-1",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    const harness = createCorpusTestHarness({ fetch, token: "tok_9" });
    const { container } = render(
      <MarkdownView markdown="before ![shot.png](attachments/th_a/t/shot.png) after" />,
      { wrapper: harness.Wrapper },
    );

    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:md-1");
    });
    expect(reads).toEqual(["/attachments/th_a/t/shot.png auth=Bearer tok_9"]);
    // The prose around it is untouched — no wrapper, no new block.
    expect(container.querySelector("p")?.textContent).toContain("before");
  });

  it("hands a remote image to the browser untouched", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(<MarkdownView markdown="![a](https://example.com/a.png)" />, {
      wrapper: harness.Wrapper,
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("a");
  });

  /**
   * ── `hardBreaks` (UI-054) ───────────────────────────────────────────
   *
   * One fixture, both modes, because the whole issue is that the *same* text
   * has to render two ways: hard-wrapped authored markdown is one paragraph,
   * and lines a person typed into a composer are lines.
   */
  describe("a single newline", () => {
    const WRAPPED = "the rate assumption\nlooks stale to me";

    it("is a space by default — a hard-wrapped document body gains no breaks", () => {
      const harness = createCorpusTestHarness({ fetch: wire().fetch });
      const { container } = render(<MarkdownView markdown={WRAPPED} />, {
        wrapper: harness.Wrapper,
      });
      expect(container.querySelectorAll("br")).toHaveLength(0);
      expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    it("is a line break when the caller asks for one", () => {
      const harness = createCorpusTestHarness({ fetch: wire().fetch });
      const { container } = render(<MarkdownView markdown={WRAPPED} hardBreaks />, {
        wrapper: harness.Wrapper,
      });
      expect(container.querySelectorAll("br")).toHaveLength(1);
      // Still one paragraph: a break, not a new block.
      expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    /**
     * The property `apps/ui`'s turn anchoring rests on (UI-051): a selection in
     * a turn is mapped from the *rendered text* back to the markdown, and the
     * two projections have to agree about the characters between two words.
     * `mdast-util-to-hast` emits a `<br>` **and** the newline it stands for, so
     * they still do — asserted here because if that ever stopped being true,
     * every comment on a selection spanning two typed lines would silently
     * start declining.
     */
    it("keeps the newline in the rendered text, so turn anchors still line up", () => {
      const harness = createCorpusTestHarness({ fetch: wire().fetch });
      const { container } = render(<MarkdownView markdown={WRAPPED} hardBreaks />, {
        wrapper: harness.Wrapper,
      });
      expect(container.querySelector("p")?.textContent).toBe(WRAPPED);
    });

    it("leaves a fenced block's newlines to the fence", () => {
      const harness = createCorpusTestHarness({ fetch: wire().fetch });
      const { container } = render(<MarkdownView markdown={"```\na\nb\n```"} hardBreaks />, {
        wrapper: harness.Wrapper,
      });
      expect(container.querySelectorAll("pre br")).toHaveLength(0);
      expect(container.querySelector("pre")?.textContent).toBe("a\nb\n");
    });

    it("does not disturb refs, which cannot span one", async () => {
      const harness = createCorpusTestHarness({ fetch: wire({ docs: { doc_b: "Rates" } }).fetch });
      const { container } = render(<MarkdownView markdown={"see [[doc_b]]\nagain"} hardBreaks />, {
        wrapper: harness.Wrapper,
      });
      await waitFor(() => {
        expect(container.querySelector(".ref")?.textContent).toBe("Rates");
      });
      expect(container.querySelectorAll("br")).toHaveLength(1);
    });
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
