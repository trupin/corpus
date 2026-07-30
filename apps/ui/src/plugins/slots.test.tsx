/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docFixture } from "../testing/readerFixture";
import { buildRegistry, setPluginRegistry, EMPTY_REGISTRY } from "./registry";
import {
  resetSlotCache,
  resolveColumnType,
  resolveDocPanel,
  resolveDocView,
  resolveListItem,
} from "./slots";

const doc: Doc = docFixture({ frontmatter: { type: "fixture-note" } });

function installRegistry(docTypeOverrides: Record<string, unknown>, columns: unknown[] = []): void {
  setPluginRegistry(
    buildRegistry([
      {
        dir: "fx",
        loaded: {
          module: {
            default: {
              id: "fx",
              name: "FX",
              docTypes: [{ type: "fixture-note", ...docTypeOverrides }],
              columns,
            },
          },
        },
      },
    ]),
  );
}

beforeEach(() => {
  resetSlotCache();
});

afterEach(() => {
  cleanup();
  setPluginRegistry(EMPTY_REGISTRY);
  resetSlotCache();
  vi.restoreAllMocks();
});

describe("slot resolution", () => {
  it("returns null for an unowned type — the core default is the fallback", () => {
    setPluginRegistry(EMPTY_REGISTRY);
    expect(resolveDocView("fixture-note")).toBeNull();
    expect(resolveListItem("fixture-note")).toBeNull();
    expect(resolveDocPanel("fixture-note")).toBeNull();
    expect(resolveColumnType("fx/board")).toBeNull();
  });

  it("returns null for an owned type whose manifest omits that renderer", () => {
    installRegistry({});
    expect(resolveDocView("fixture-note")).toBeNull();
    expect(resolveListItem("fixture-note")).toBeNull();
    expect(resolveDocPanel("fixture-note")).toBeNull();
  });

  it("renders a registered View", () => {
    installRegistry({
      View: ({ doc: viewed }: { doc: Doc }) => <p>plugin view of {viewed.frontmatter.title}</p>,
    });
    const View = resolveDocView("fixture-note");
    expect(View).not.toBeNull();
    if (View === null) return;
    render(<View doc={doc} />);
    expect(screen.getByText(`plugin view of ${doc.frontmatter.title}`)).toBeTruthy();
  });

  it("returns a stable component identity across calls — no remount per render", () => {
    installRegistry({ View: () => null });
    expect(resolveDocView("fixture-note")).toBe(resolveDocView("fixture-note"));
  });

  it("a throwing View renders the error card in place and does not propagate", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installRegistry({
      View: () => {
        throw new Error("view exploded");
      },
    });
    const View = resolveDocView("fixture-note");
    if (View === null) throw new Error("expected a View");
    render(
      <>
        <View doc={doc} />
        <p>the rest of the board</p>
      </>,
    );
    const card = screen.getByRole("alert");
    expect(card.textContent).toContain("fx");
    expect(card.textContent).toContain("view exploded");
    // Siblings survive: the crash stayed inside the slot's own boundary.
    expect(screen.getByText("the rest of the board")).toBeTruthy();
  });

  it("a throwing column Component shows the card naming plugin and role", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installRegistry({}, [
      {
        type: "board",
        label: "Board",
        Component: () => {
          throw new Error("column exploded");
        },
      },
    ]);
    const Column = resolveColumnType("fx/board");
    if (Column === null) throw new Error("expected a column Component");
    render(<Column viewDocId="doc_v1" title="Board" query={{}} />);
    expect(screen.getByRole("alert").textContent).toContain("column");
  });

  it("exposes exactly four resolvers — DocPanel is the only injection slot in v1", async () => {
    const slots = await import("./slots");
    const resolvers = Object.keys(slots).filter((name) => name.startsWith("resolve"));
    expect(resolvers.sort()).toEqual([
      "resolveColumnType",
      "resolveDocPanel",
      "resolveDocView",
      "resolveListItem",
    ]);
  });
});
