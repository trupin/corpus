/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { useRef, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEN_RATIO, useColumnVisibility } from "./useColumnVisibility";

/**
 * UI-151 — rider 4's "a tab for a column off screen is dimmed", at the level a
 * DOM without layout can answer: what the hook observes, what it does with the
 * ratios it is told, and what it says when it is told nothing.
 *
 * jsdom has no `IntersectionObserver` and no layout, so a real one is stubbed
 * and driven by hand. The **scrolling** half of the rule — that a column
 * genuinely leaving the viewport dims its tab — is only provable in a browser,
 * and `apps/ui/e2e/column-strip.spec.ts` is where it is proved.
 */

interface Instance {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  readonly observed: Element[];
  disconnected: boolean;
}

let instances: Instance[] = [];

class TestIntersectionObserver {
  private readonly self: Instance;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.self = { callback, options, observed: [], disconnected: false };
    instances.push(this.self);
  }

  observe(element: Element): void {
    this.self.observed.push(element);
  }

  unobserve(): void {
    /* the hook only ever disconnects */
  }

  disconnect(): void {
    this.self.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function Harness({ keys }: { readonly keys: readonly string[] }): ReactElement {
  const board = useRef<HTMLElement>(null);
  const seen = useColumnVisibility(board, keys);
  return (
    <div>
      <main className="board" ref={board}>
        {keys.map((key) => (
          <section className="col" data-col={key} key={key} />
        ))}
      </main>
      <p data-testid="seen">{keys.filter((key) => seen.has(key)).join(",")}</p>
    </div>
  );
}

function fire(ratios: Readonly<Record<string, number>>): void {
  const observer = instances.at(-1);
  if (observer === undefined) throw new Error("no observer was created");
  const entries = Object.entries(ratios).map(([key, ratio]) => ({
    target: document.querySelector(`.col[data-col="${key}"]`) as Element,
    intersectionRatio: ratio,
  }));
  act(() => {
    observer.callback(
      entries as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  instances = [];
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useColumnVisibility", () => {
  it("observes every column of the board, rooted at the board, at the half-in-view line", () => {
    const { container } = render(<Harness keys={["a", "b"]} />);

    const observer = instances.at(-1);
    expect(observer?.observed).toHaveLength(2);
    expect(observer?.options?.root).toBe(container.querySelector(".board"));
    expect(observer?.options?.threshold).toEqual([SEEN_RATIO]);
  });

  it("marks a column seen at half in view and unseen below it", () => {
    const { getByTestId } = render(<Harness keys={["a", "b", "c"]} />);
    expect(getByTestId("seen").textContent).toBe("");

    fire({ a: 1, b: SEEN_RATIO, c: 0.49 });
    expect(getByTestId("seen").textContent).toBe("a,b");

    // Scrolled away: the verdict is withdrawn, which is what dims the tab.
    fire({ a: 0, b: 0.2 });
    expect(getByTestId("seen").textContent).toBe("");
  });

  it("drops the verdict of a column that left, so a returning key is re-observed", () => {
    const { getByTestId, rerender } = render(<Harness keys={["a", "b"]} />);
    fire({ a: 1, b: 1 });
    expect(getByTestId("seen").textContent).toBe("a,b");

    rerender(<Harness keys={["a"]} />);
    expect(getByTestId("seen").textContent).toBe("a");

    rerender(<Harness keys={["a", "b"]} />);
    expect(getByTestId("seen").textContent).toBe("a");
  });

  it("re-observes when the column set changes, and disconnects the old observer", () => {
    const { rerender } = render(<Harness keys={["a"]} />);
    const first = instances.at(-1);

    rerender(<Harness keys={["a", "b"]} />);

    expect(first?.disconnected).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances.at(-1)?.observed).toHaveLength(2);
  });

  it("claims nothing is off screen when there is no observer to ask", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { getByTestId } = render(<Harness keys={["a", "b"]} />);

    // Not "everything is hidden": a dimmed tab is an assertion about where the
    // board is scrolled to, and nothing here has observed anything.
    expect(getByTestId("seen").textContent).toBe("a,b");
    expect(instances).toHaveLength(0);
  });
});
