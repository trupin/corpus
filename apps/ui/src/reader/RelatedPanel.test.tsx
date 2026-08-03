/** @vitest-environment jsdom */
import type { CorpusTestHarness } from "@corpus/kit/testing";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState";
import {
  backlinksSearch,
  docFixture,
  readerTransport,
  relatedFixture,
  relatedPath,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { FocusMode } from "./FocusMode";
import { Reader } from "./Reader";
import { resetEscapeLayers } from "./useEscapeStack";

/**
 * UI-025's related panel, in both hosts.
 *
 * Asserted through the real reader against a recording transport rather than by
 * rendering the component with props: the finding this suite exists to prevent
 * is not "the list renders" but "the reader asks the right route, under a key
 * the server's frames reach, and pushes the stack when a row is clicked" — three
 * facts a props-only test cannot see.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const MORTGAGE = docFixture({
  frontmatter: { id: "doc_m", title: "Mortgage options" },
  body: "Compare against [[doc_r]].",
});

const RATES = docFixture({
  frontmatter: { id: "doc_r", title: "Rates" },
  body: "6.4% this week.",
  path: "data/docs/finance/rates.md",
});

const OFFERS = docFixture({
  frontmatter: { id: "doc_o", title: "Lender offers" },
  body: "Two lenders quoted.",
  path: "data/docs/finance/offers.md",
});

/**
 * A ranking with all three relations in it, in the server's order — the panel's
 * whole contract is that it prints this list as it arrives. `similar` and `both`
 * are Phase B's values; the UI has never been allowed to branch on which phase
 * produced a row, so a fixture carrying only `linked` would pin a third of the
 * vocabulary and pass while the other two disappeared.
 */
const RANKED = [
  relatedFixture({ id: "doc_r", title: "Rates", relation: "linked" }),
  relatedFixture({ id: "doc_o", title: "Lender offers", relation: "similar" }),
  relatedFixture({ id: "doc_x", title: "Payoff plan", relation: "both" }),
];

function wire(overrides: Partial<Parameters<typeof readerTransport>[0]> = {}): ReaderTransport {
  return readerTransport({
    docs: [MORTGAGE, RATES, OFFERS],
    rows: {
      [threadsSearch("doc_m")]: [],
      [backlinksSearch("doc_m")]: [
        threadRowFixture({ id: "doc_b", type: "note", title: "Budget" }),
      ],
    },
    related: { doc_m: RANKED },
    ...overrides,
  });
}

interface HostProps {
  readonly transport: ReaderTransport;
  readonly onHarness?: (harness: CorpusTestHarness) => void;
  readonly onNav?: (nav: readonly NavEntry[]) => void;
  /** No open document — the state a column spends most of its life in. */
  readonly closed?: boolean;
}

/** The column reader. */
function Column({ transport, onHarness, onNav, closed }: HostProps): ReactElement {
  const [nav, setNav] = useState<readonly NavEntry[]>(
    closed === true ? [] : [{ docId: "doc_m", scrollY: 0 }],
  );
  const [harness] = useState(() => {
    const built = createCorpusTestHarness({ fetch: transport.fetch, batchWindowMs: 0 });
    onHarness?.(built);
    return built;
  });
  return (
    <harness.Wrapper>
      <div className={nav.length === 0 ? "col" : "col reading"}>
        {nav.length === 0 ? null : (
          <Reader
            columnId="doc_col"
            columnTitle="Finance"
            nav={nav}
            setNav={(next) => {
              setNav(next);
              onNav?.(next);
            }}
            selectTitle={false}
            isActive
            onFocusMode={() => undefined}
            onNotify={() => undefined}
          />
        )}
      </div>
    </harness.Wrapper>
  );
}

/** Focus mode — the same `DocView`, the other host. */
function Focus({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <FocusMode
        docId="doc_m"
        listTitle="Finance"
        onClose={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

const rows = (root: ParentNode): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(".related .related-doc"),
];

async function showsPanel(root: ParentNode): Promise<void> {
  await waitFor(() => {
    expect(root.querySelector(".related h3")).not.toBeNull();
  });
}

describe("the related panel", () => {
  it("renders the ranking in the server's order, each row saying why", async () => {
    const { container } = render(<Column transport={wire()} />);
    await showsPanel(container);

    expect(container.querySelector(".related h3")?.textContent).toBe("Related");
    expect(rows(container).map((row) => row.querySelector(".ref")?.textContent)).toEqual([
      "Rates",
      "Lender offers",
      "Payoff plan",
    ]);
    // The server's word, verbatim — all three of them, unmapped.
    expect(rows(container).map((row) => row.querySelector(".relation")?.textContent)).toEqual([
      "linked",
      "similar",
      "both",
    ]);
  });

  it("renders a relation the client has never heard of rather than dropping the row", async () => {
    const unknown = [relatedFixture({ id: "doc_r", title: "Rates", relation: "linked" })].concat([
      // A value a future server might add. The vocabulary was frozen so this
      // renders as the label it is instead of falling through a match.
      { ...relatedFixture({ id: "doc_o", title: "Lender offers" }), relation: "cited" } as never,
    ]);
    const { container } = render(<Column transport={wire({ related: { doc_m: unknown } })} />);
    await showsPanel(container);

    expect(rows(container)).toHaveLength(2);
    expect(rows(container)[1]?.querySelector(".relation")?.textContent).toBe("cited");
  });

  it("reads the related route once for the open document", async () => {
    const transport = wire();
    const { container } = render(<Column transport={transport} />);
    await showsPanel(container);

    expect(transport.of("GET", relatedPath("doc_m"))).toHaveLength(1);
  });

  it("pushes the navigation stack when a row is followed, and Back returns", async () => {
    const seen: (readonly NavEntry[])[] = [];
    const transport = wire();
    const { container } = render(
      <Column
        transport={transport}
        onNav={(next) => {
          seen.push(next);
        }}
      />,
    );
    await showsPanel(container);

    fireEvent.click(container.querySelector('[data-related="doc_r"]') as HTMLElement);

    await waitFor(() => {
      expect(container.querySelector<HTMLInputElement>(".doc-title")?.value).toBe("Rates");
    });
    // A push, exactly as a `[[ref]]` or a backlink makes one: the entry the
    // reader came from is still under it, which is what Back pops to.
    expect(seen.at(-1)?.map((entry) => entry.docId)).toEqual(["doc_m", "doc_r"]);

    fireEvent.click(container.querySelector(".back") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector<HTMLInputElement>(".doc-title")?.value).toBe(
        "Mortgage options",
      );
    });
    expect(seen.at(-1)?.map((entry) => entry.docId)).toEqual(["doc_m"]);
  });

  // TEST-1014: `null`, not an empty box. No heading, no container, no "None".
  it("renders nothing at all when nothing is related", async () => {
    const transport = wire({ related: {} });
    const { container } = render(<Column transport={transport} />);
    await waitFor(() => {
      expect(container.querySelector(".doc-title")).not.toBeNull();
    });
    // The request was made and answered empty — the absence is the answer, not
    // a query that never ran.
    await waitFor(() => {
      expect(transport.of("GET", relatedPath("doc_m"))).toHaveLength(1);
    });
    expect(container.querySelector(".related")).toBeNull();
    expect(container.textContent).not.toContain("Related");
  });

  it("is absent in focus mode too when nothing is related", async () => {
    render(<Focus transport={wire({ related: {} })} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-title")).not.toBeNull();
    });
    expect(document.querySelector(".focus .related")).toBeNull();
  });

  // TEST-1015: one component, two hosts. Both get it from the single `DocView`
  // mount, and neither mounts a second one.
  it("appears in focus mode from the same single mount", async () => {
    render(<Focus transport={wire()} />);
    await showsPanel(document);

    expect(document.querySelectorAll(".focus .related")).toHaveLength(1);
    expect(document.querySelectorAll(".related")).toHaveLength(1);
    expect(rows(document).map((row) => row.querySelector(".relation")?.textContent)).toEqual([
      "linked",
      "similar",
      "both",
    ]);
  });

  // TEST-1017: a column with nothing open mounts no reader and asks nothing.
  it("issues no related request while the column has nothing open", async () => {
    const transport = wire();
    render(<Column transport={transport} closed />);
    // Long enough for a mounted reader's queries to have gone out.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(transport.of("GET", relatedPath("doc_m"))).toHaveLength(0);
    // And nothing else either: the column mounts no reader, so there is no
    // query to disable in the first place.
    expect(transport.calls).toEqual([]);
  });

  /**
   * TEST-1018 / Open Conflict 7. The panel's key sits under the `["docs"]`
   * prefix the server already emits on every document and thread mutation, so a
   * `[[ref]]` landing anywhere in the workspace refreshes it with no new frame
   * and no key name of its own added to the vocabulary. This is the assertion
   * that would fail if the key were
   * moved out from under that prefix — every other test here would still pass.
   */
  it("refetches on the `docs` frame the server already sends", async () => {
    const transport = wire();
    let harness: CorpusTestHarness | undefined;
    const { container } = render(
      <Column
        transport={transport}
        onHarness={(built) => {
          harness = built;
        }}
      />,
    );
    await showsPanel(container);
    expect(transport.of("GET", relatedPath("doc_m"))).toHaveLength(1);

    harness?.eventSource.latest().invalidate(["docs"]);

    await waitFor(() => {
      expect(transport.of("GET", relatedPath("doc_m"))).toHaveLength(2);
    });
  });

  it("sits beside the backlinks panel rather than replacing it", async () => {
    const { container } = render(<Column transport={wire()} />);
    await showsPanel(container);

    const main = container.querySelector(".doc-main") as HTMLElement;
    const panels = [...main.children].filter(
      (child) => child.classList.contains("backlinks") || child.classList.contains("related"),
    );
    expect(panels.map((panel) => panel.className)).toEqual(["backlinks", "related"]);
    expect(container.querySelector(".backlinks h3")?.textContent).toBe("Referenced by");
  });
});
