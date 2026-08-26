/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { AGENTS_KEY, docKey } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { docFixture, readerTransport } from "../testing/readerFixture";
import { ScopeProvenance } from "./ScopeProvenance";

afterEach(cleanup);

const LANE: AgentLane = {
  lane: "th_root",
  resident: { name: "researcher", docId: "doc_agentdef", weight: null, designationId: null },
  live: false,
  since: null,
  pending: 0,
  working: false,
  summary: null,
  origin: { id: "th_root", title: "Q3 planning" },
};

function renderProvenance(
  docId: string,
  options: {
    readonly origin?: string | null;
    readonly lanes?: readonly AgentLane[];
  } = {},
): {
  readonly container: HTMLElement;
  readonly opened: string[];
  /** Resolves once both reads the walk needs have landed — what a *negative* waits on. */
  readonly settled: () => Promise<void>;
} {
  const opened: string[] = [];
  const transport = readerTransport({
    lanes: options.lanes ?? [LANE],
    docs: [docFixture({ frontmatter: { id: docId, origin: options.origin ?? null } })],
  });
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  const Wrapped = (): ReactElement => (
    <harness.Wrapper>
      <ScopeProvenance
        docId={docId}
        onOpenDoc={(id) => {
          opened.push(id);
        }}
      />
    </harness.Wrapper>
  );
  return {
    container: render(<Wrapped />).container,
    opened,
    settled: async () => {
      // A `waitFor` over an absence passes on its first tick, so a test that
      // asserts nothing is drawn has to wait for the answers that *would* have
      // drawn it — otherwise it passes against a component that renders the
      // line eagerly (verified: removing the root-thread guard left it green).
      await waitFor(() => {
        expect(harness.queryClient.getQueryData(AGENTS_KEY)).toBeDefined();
        expect(harness.queryClient.getQueryData(docKey(docId))).toBeDefined();
      });
    },
  };
}

const line = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>(".scope-provenance");

describe("ScopeProvenance", () => {
  /**
   * §7's own argument for scope, made visible on the artifact: "a conversation
   * that produces a draft, and a comment left on that draft, reach the same
   * agent". Without this line, the draft looks like any other note and the
   * person commenting on it has no way to know who will answer.
   */
  it("says which conversation this document came out of, and who is resident in it", async () => {
    const { container } = renderProvenance("doc_draft", { origin: "th_root" });

    await waitFor(() => {
      expect(line(container)).not.toBeNull();
    });
    expect(line(container)?.textContent).toContain("part of");
    expect(line(container)?.textContent).toContain("Q3 planning");
    expect(line(container)?.textContent).toContain("researcher");
    expect(line(container)?.dataset["provenanceLane"]).toBe("th_root");
  });

  it("is a way back to the conversation, not just a label", async () => {
    const { container, opened } = renderProvenance("doc_draft", { origin: "th_root" });

    await waitFor(() => {
      expect(line(container)).not.toBeNull();
    });
    fireEvent.click(container.querySelector("[data-provenance-open]") as HTMLElement);
    expect(opened).toEqual(["th_root"]);
  });

  /**
   * The ordinary document, which is nearly all of them. Belonging to no
   * conversation is not a fact worth a line, and a reader that grew one for
   * every note would be noise.
   */
  it("draws nothing for a document that reaches no designated root", async () => {
    const view = renderProvenance("doc_loose", { origin: null });
    await view.settled();
    expect(line(view.container)).toBeNull();
  });

  /**
   * The designated conversation itself already wears its resident in the thread
   * head; a line beneath it saying it is part of itself is noise.
   */
  it("draws nothing on the designated root thread itself", async () => {
    const view = renderProvenance("th_root", { origin: null });
    await view.settled();
    expect(view.container.querySelector(".lane-dot")).toBeNull();
    expect(line(view.container)).toBeNull();
  });

  /**
   * Scope is the walk (SHARED-044), and a walk whose reads have not landed has
   * no answer — naming one from a read that has not returned is the unevidenced
   * claim UI-098 removed from the console.
   */
  it("says nothing while the walk has not reached a verdict", () => {
    const { container } = renderProvenance("doc_draft", { origin: "th_root" });
    expect(line(container)).toBeNull();
  });

  it("names the lane itself when the roster carries no title for the conversation", async () => {
    const { container } = renderProvenance("doc_draft", {
      origin: "th_root",
      lanes: [{ ...LANE, origin: null }],
    });

    await waitFor(() => {
      expect(line(container)).not.toBeNull();
    });
    expect(container.querySelector("[data-provenance-open]")?.textContent).toBe("th_root");
  });
});

describe("the liveness it shows", () => {
  it("is the lane's own, in the dot the recipient picker uses", async () => {
    const { container } = renderProvenance("doc_draft", {
      origin: "th_root",
      lanes: [{ ...LANE, live: true, since: new Date(Date.now() - 60_000).toISOString() }],
    });

    await waitFor(() => {
      expect(container.querySelector(".lane-dot.live")).not.toBeNull();
    });
  });
});
