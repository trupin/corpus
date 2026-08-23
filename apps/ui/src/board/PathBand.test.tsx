/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { docFixture, readerTransport } from "../testing/readerFixture";
import { PathBand, type PathActs } from "./PathBand";
import type { PathItem } from "./strip";

afterEach(cleanup);

/**
 * The path column's own chrome (SPEC.md §10, rider 3; the prototype's `.pcol`):
 * the head's `◂` line, the ✕, and the ⋯ menu of path acts. The acts themselves
 * are `strip.ts`'s and are tested there; what these prove is that the chrome
 * calls the right one.
 */

const MORTGAGE = docFixture({
  frontmatter: { id: "doc_m", title: "Mortgage options" },
  body: "Compare fixed against tracker.",
});
const RATES = docFixture({ frontmatter: { id: "doc_r", title: "Rates" }, body: "6.2% today." });

function acts(): PathActs & { readonly calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length === 0 ? name : `${name}:${String(args[0])}`);
    };
  return {
    calls,
    follow: record("follow"),
    setStack: record("setStack"),
    setWidth: record("setWidth"),
    closeAfter: record("closeAfter"),
    closeWholePath: record("closeWholePath"),
    restartHere: record("restartHere"),
    newPathRight: record("newPathRight"),
    detach: record("detach"),
    focusMode: record("focusMode"),
  };
}

function pathOf(overrides: Partial<PathItem> = {}): PathItem {
  return {
    kind: "path",
    id: 1,
    origin: { view: "doc_view", doc: "doc_m" },
    cols: [{ stack: [{ docId: "doc_m", scrollY: 0 }] }],
    ...overrides,
  };
}

function renderBand(
  path: PathItem,
  options: { readonly originTitle?: string | null } = {},
): { readonly acts: PathActs & { readonly calls: string[] }; readonly container: HTMLElement } {
  const wire = readerTransport({ docs: [MORTGAGE, RATES] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const spy = acts();
  function Wrapper({ children }: { readonly children?: React.ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ContextMenuProvider>{children}</ContextMenuProvider>
      </harness.Wrapper>
    );
  }
  const { container } = render(
    <PathBand
      path={path}
      originTitle={options.originTitle === undefined ? "Inbox" : options.originTitle}
      activeKey={null}
      flashingKey={null}
      selectTitleFor={null}
      acts={spy}
      onActivate={() => undefined}
      onNotify={() => undefined}
    />,
    { wrapper: Wrapper },
  );
  return { acts: spy, container };
}

describe("PathBand", () => {
  it("draws a dashed band for an origin path and a solid one for a loose path", () => {
    const { container } = renderBand(pathOf());
    expect(container.querySelector(".path")?.className).toBe("path");

    cleanup();
    const loose = renderBand(pathOf({ origin: null }), { originTitle: null });
    expect(loose.container.querySelector(".path")?.className).toBe("path loose");
  });

  it("names the origin column on the root head, and 'no origin' on a loose one", () => {
    const { container } = renderBand(pathOf());
    expect(container.querySelector(".pcol-from")?.textContent).toContain("Inbox");

    cleanup();
    const loose = renderBand(pathOf({ origin: null }), { originTitle: null });
    expect(loose.container.querySelector(".pcol-from")?.textContent).toContain("no origin");
  });

  it("names the previous column's document on a continuation column's head", async () => {
    const { container } = renderBand(
      pathOf({
        cols: [
          { stack: [{ docId: "doc_m", scrollY: 0 }] },
          { stack: [{ docId: "doc_r", scrollY: 0 }] },
        ],
      }),
    );
    const heads = container.querySelectorAll(".pcol-from");
    expect(heads).toHaveLength(2);
    await waitFor(() => {
      expect(heads[1]?.textContent).toContain("Mortgage options");
    });
  });

  it("mounts the existing Reader over the column's own stack", async () => {
    const { container } = renderBand(pathOf());
    await waitFor(() => {
      expect(container.querySelector(".pcol .reader")).not.toBeNull();
    });
    expect(container.querySelector(".reader")?.getAttribute("data-reader-column")).toBe("path:1:0");
    expect(container.querySelector(".reader")?.getAttribute("data-reader-doc")).toBe("doc_m");
  });

  it("✕ closes this column and everything after it", () => {
    const { acts: spy, container } = renderBand(pathOf());
    const close = container.querySelector(
      '[aria-label="Close this column and everything after it"]',
    );
    if (close === null) throw new Error("no close button");
    fireEvent.click(close);
    expect(spy.calls).toEqual(["closeAfter:0"]);
  });

  it("offers the prototype's path menu from ⋯, wired to the acts", async () => {
    const { acts: spy, container } = renderBand(pathOf());
    fireEvent.click(container.querySelector('[aria-label="Path actions"]') as Element);

    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent ?? "",
    );
    expect(labels.join("|")).toContain("Open in full screen");
    expect(labels.join("|")).toContain("Restart the path here");
    expect(labels.join("|")).toContain("New path to the right");
    expect(labels.join("|")).toContain("Keep — detach from its origin");
    expect(labels.join("|")).toContain("Close this column and after");
    expect(labels.join("|")).toContain("Close the whole path");

    fireEvent.click(screen.getByText("Restart the path here"));
    await waitFor(() => {
      expect(spy.calls).toEqual(["restartHere:0"]);
    });
  });

  it("disables restart on a loose path's root — it is already exactly that", () => {
    const { container } = renderBand(pathOf({ origin: null }), { originTitle: null });
    fireEvent.click(container.querySelector('[aria-label="Path actions"]') as Element);
    const restart = screen.getByText("Restart the path here").closest("[role='menuitem']");
    expect((restart as HTMLButtonElement).disabled).toBe(true);
    // And a loose path has no origin to detach from.
    expect(screen.queryByText(/Keep — detach/)).toBeNull();
  });

  it("renders each column at its own width — 440 by default, its stored width otherwise", () => {
    const { container } = renderBand(
      pathOf({
        cols: [
          { stack: [{ docId: "doc_m", scrollY: 0 }] },
          { stack: [{ docId: "doc_r", scrollY: 0 }], width: 520 },
        ],
      }),
    );
    const cols = container.querySelectorAll<HTMLElement>(".pcol");
    expect(cols[0]?.style.width).toBe("440px");
    expect(cols[1]?.style.width).toBe("520px");
  });
});
