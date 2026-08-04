/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { CorpusImage } from "./CorpusImage.js";
import { ImageViewerProvider, type ViewableImage } from "./imageViewer.js";

afterEach(cleanup);

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let sequence = 0;
  // jsdom implements neither half of the object-URL API.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => {
      sequence += 1;
      const url = `blob:bytes-${String(sequence)}`;
      created.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revoked.push(url);
    },
  });
});

interface Transport {
  readonly fetch: typeof globalThis.fetch;
  /** Every request the client made, as `<path> auth=<header or "">`. */
  readonly calls: string[];
}

function wire(status = 200): Transport {
  const calls: string[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${url.pathname} auth=${request.headers.get("authorization") ?? ""}`);
    return Promise.resolve(
      status === 200
        ? new Response(new Blob(["png-bytes"]), { status })
        : new Response(JSON.stringify({ code: "not_found", message: url.pathname }), {
            status,
            headers: { "content-type": "application/json" },
          }),
    );
  };
  return { fetch, calls };
}

const TARGET = "attachments/th_a/2026-07-01T09%3A05%3A00.000Z/shot.png";

/** The viewer half of the seam, recorded. */
function viewerHarness(): {
  readonly opened: { image: ViewableImage; origin: HTMLElement | null }[];
  readonly Viewer: (props: { readonly children?: ReactNode }) => ReactElement;
} {
  const opened: { image: ViewableImage; origin: HTMLElement | null }[] = [];
  function Viewer({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <ImageViewerProvider
        open={(image, origin) => {
          opened.push({ image, origin });
        }}
      >
        {children}
      </ImageViewerProvider>
    );
  }
  return { opened, Viewer };
}

describe("CorpusImage: where the bytes come from", () => {
  /**
   * The bug UI-049 fixes. `/attachments/*` is behind the workspace bearer token
   * and an `<img src>` sends no `Authorization` header, so a reference left as
   * a bare relative source resolves against the SPA route and loads nothing.
   */
  it("fetches a workspace attachment with the bearer token and paints the blob", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch, token: "tok_1" });
    const { container } = render(<CorpusImage src={TARGET} alt="shot.png" />, {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:bytes-1");
    expect(transport.calls).toEqual([`/${TARGET} auth=Bearer tok_1`]);
  });

  it.each([
    ["a remote URL", "https://example.com/a.png"],
    ["a data URL", "data:image/png;base64,iVBORw0KGgo="],
  ])("leaves %s exactly as written, and fetches nothing", async (_label, src) => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { container } = render(<CorpusImage src={src} alt="a" />, { wrapper: harness.Wrapper });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(src);
    await waitFor(() => {
      expect(transport.calls).toEqual([]);
    });
  });

  /** No leak per rendered body: the URL this mount created is the one it revokes. */
  it("revokes the object URL on unmount", async () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const view = render(<CorpusImage src={TARGET} alt="shot.png" />, {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(created).toEqual(["blob:bytes-1"]);
    });
    view.unmount();
    expect(revoked).toEqual(["blob:bytes-1"]);
  });
});

describe("CorpusImage: a reference whose bytes never arrive", () => {
  it("degrades to a visible chip naming the file, never a blank", async () => {
    const harness = createCorpusTestHarness({ fetch: wire(404).fetch });
    const { container } = render(<CorpusImage src={TARGET} alt="shot.png" />, {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(container.querySelector(".md-img-broken")).not.toBeNull();
    });
    expect(container.querySelector(".md-img-broken")?.textContent).toContain("shot.png");
    expect(container.querySelector("img")).toBeNull();
  });

  /** With no alt to show, the stored filename is what names the chip. */
  it("names an unnamed reference by its last path segment", async () => {
    const harness = createCorpusTestHarness({ fetch: wire(404).fetch });
    const { container } = render(<CorpusImage src="attachments/th_a/t/plan.png" alt="" />, {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(container.querySelector(".md-img-broken")?.textContent).toContain("plan.png");
    });
  });

  it("says the bytes are on their way while they are", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(<CorpusImage src={TARGET} alt="shot.png" />, {
      wrapper: harness.Wrapper,
    });
    expect(container.querySelector(".md-img-pending")?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("CorpusImage: opening the viewer", () => {
  it("is a plain image with no viewer mounted", () => {
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    const { container } = render(<CorpusImage src="https://example.com/a.png" alt="a" />, {
      wrapper: harness.Wrapper,
    });
    const image = container.querySelector("img");
    expect(image?.getAttribute("role")).toBeNull();
    expect(image?.getAttribute("tabindex")).toBeNull();
  });

  it("is a focusable control that opens on click, with itself as the origin", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );

    const image = screen.getByRole("button", { name: "A chart — open full screen" });
    expect(image.getAttribute("tabindex")).toBe("0");
    fireEvent.click(image);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.image).toEqual({ src: "https://example.com/a.png", alt: "A chart" });
    expect(opened[0]?.origin).toBe(image);
  });

  /** SPEC.md §11's keyboard scheme: the image is reachable and `↵` opens it. */
  it("opens on ↵", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(opened).toHaveLength(1);
  });

  it("ignores every other key", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    const image = screen.getByRole("button");
    fireEvent.keyDown(image, { key: " " });
    fireEvent.keyDown(image, { key: "Escape" });
    expect(opened).toEqual([]);
  });

  /**
   * UI-042. A drag that selects prose containing an image ends *on* the image
   * and fires a click there; that gesture belongs to the selection.
   */
  it("declines a click that ends a selection covering it", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    const image = screen.getByRole("button");
    vi.spyOn(globalThis, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "some prose and the picture",
      containsNode: (node: Node) => node === image,
    } as unknown as Selection);

    fireEvent.click(image);
    expect(opened).toEqual([]);
    vi.restoreAllMocks();
  });

  /**
   * The other side of that guard, and the one a real browser found: clicking an
   * image inside the editor node-selects it, which *is* a non-collapsed DOM
   * selection spanning the element — with no text in it. Reading that as a drag
   * swallowed every click on an image in a document body.
   */
  it("opens on a node selection over the image, which carries no text", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    const image = screen.getByRole("button");
    vi.spyOn(globalThis, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "",
      containsNode: (node: Node) => node === image,
    } as unknown as Selection);

    fireEvent.click(image);
    expect(opened).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("still opens when the selection is elsewhere", () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src="https://example.com/a.png" alt="A chart" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    vi.spyOn(globalThis, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "prose elsewhere",
      containsNode: () => false,
    } as unknown as Selection);

    fireEvent.click(screen.getByRole("button"));
    expect(opened).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("opens an attachment with the blob source, never the reference", async () => {
    const { opened, Viewer } = viewerHarness();
    const harness = createCorpusTestHarness({ fetch: wire().fetch });
    render(
      <Viewer>
        <CorpusImage src={TARGET} alt="shot.png" className="turn-att-img" />
      </Viewer>,
      { wrapper: harness.Wrapper },
    );
    const image = await screen.findByRole("button");
    // The host's sizing class survives beside the shared one.
    expect(image.className).toBe("md-img turn-att-img");
    fireEvent.click(image);
    expect(opened[0]?.image.src).toBe("blob:bytes-1");
  });
});
