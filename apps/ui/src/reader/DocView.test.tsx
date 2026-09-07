/** @vitest-environment jsdom */
import type { Doc, DocRow } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  backlinksSearch,
  costFixture,
  costPath,
  docFixture,
  readerTransport,
  relatedFixture,
  threadFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { docRowFixture } from "@corpus/kit/testing";
import { Reader } from "./Reader";
import { REVEAL_SETTLED_ATTRIBUTE } from "./reveal";
import { resetEscapeLayers } from "./useEscapeStack";

/**
 * Which renderer a document body gets (UI-014).
 *
 * Two outcomes in a fixed order — a thread's conversation, and otherwise the
 * always-editable editor — asserted through the real reader rather than by
 * calling the gate, because the whole finding was that the gate and the call
 * site disagreed about what "the core does not know this type" should mean.
 *
 * **There is no third outcome**, and the rule that leaves is the one SPEC.md
 * §12's M6 protects: a document whose `type:` this build does not recognise
 * opens in the ordinary document view. Nothing may claim a type first, because
 * the set of types on the wire is not the set any one build knows — an older
 * workspace's documents, a hand-written file, or a server newer than this
 * client (§5).
 */

/**
 * The M6 document: a `type:` nothing in this build knows, holding a checkbox.
 * `todo` on purpose — it is the unrecognised type real workspaces already hold.
 */
const UNKNOWN_DOC = docFixture({
  frontmatter: { id: "doc_x", type: "todo", title: "Inbox chores" },
  body: "Prose nobody claims.\n\n- [ ] Call the plumber\n",
});

const VIEW_DOC = docFixture({
  frontmatter: { id: "doc_v", type: "view", title: "A saved query" },
  body: "The description of a view.",
});

function wireFor(...docs: readonly Doc[]): ReaderTransport {
  const rows: Record<string, readonly DocRow[]> = {};
  for (const doc of docs) {
    rows[threadsSearch(doc.frontmatter.id)] = [];
    rows[backlinksSearch(doc.frontmatter.id)] = [];
  }
  return readerTransport({ docs, rows });
}

function open(doc: Doc, wire: ReaderTransport): ReactElement {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  return (
    <harness.Wrapper>
      <div className="col reading">
        <Reader
          columnId="doc_col"
          columnTitle="Finance"
          nav={[{ docId: doc.frontmatter.id, scrollY: 0 }]}
          setNav={() => undefined}
          selectTitle={false}
          isActive
          onFocusMode={() => undefined}
          onNotify={() => undefined}
        />
      </div>
    </harness.Wrapper>
  );
}

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const editorFor = (docId: string): Element | null =>
  document.querySelector(`[data-doc-editor="${docId}"]`);

describe("the body renderer a document gets", () => {
  /**
   * **SPEC.md §12's M6, at the reader.** A workspace holds whatever its owner
   * and its agent have written, `type:` is an open string on the wire (§5), and
   * a document typed for something this build has never heard of gets the
   * ordinary document view — the editor, editable, with its markdown rendered
   * and its checkboxes real. Not a placeholder, not a read-only render, not a
   * refusal.
   */
  it("gives an unrecognised type the editable editor, exactly like a core note", async () => {
    render(open(UNKNOWN_DOC, wireFor(UNKNOWN_DOC)));
    await waitFor(() => {
      expect(editorFor("doc_x")).not.toBeNull();
    });
    const editor = editorFor("doc_x");
    expect(editor?.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(screen.getByText("Prose nobody claims.")).toBeTruthy();
    // The markdown is rendered, not printed: the task item is a real checkbox.
    expect(editor?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(screen.getByText("Call the plumber")).toBeTruthy();
  });

  it("leaves a view document to the static render — its content is its query", async () => {
    render(open(VIEW_DOC, wireFor(VIEW_DOC)));
    await waitFor(() => {
      expect(screen.getByText("The description of a view.")).toBeTruthy();
    });
    expect(editorFor("doc_v")).toBeNull();
  });
});

/**
 * The reveal reads this, and the whole "not there" / "not there yet"
 * distinction rests on it (UI-140, and its PR #54 follow-up). The placeholder
 * must never claim to have arrived: a reveal that believed it would report a
 * quote as gone from a document that had not rendered a word yet.
 */
describe("a reader whose document has not arrived", () => {
  it("claims no arrival while it is a placeholder, and claims one with the body", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wire = wireFor(UNKNOWN_DOC);
    const gated: typeof wire.fetch = async (input, init) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target.includes("/api/docs/doc_x")) await held;
      return wire.fetch(input, init);
    };

    const harness = createCorpusTestHarness({ fetch: gated });
    render(
      <harness.Wrapper>
        <div className="col reading">
          <Reader
            columnId="doc_col"
            columnTitle="Finance"
            nav={[{ docId: "doc_x", scrollY: 0 }]}
            setNav={() => undefined}
            selectTitle={false}
            isActive
            onFocusMode={() => undefined}
            onNotify={() => undefined}
          />
        </div>
      </harness.Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(document.querySelector(`[${REVEAL_SETTLED_ATTRIBUTE}]`)).toBeNull();

    act(() => {
      release();
    });
    await waitFor(() => {
      expect(document.querySelector(`[${REVEAL_SETTLED_ATTRIBUTE}]`)).not.toBeNull();
    });
  });
});

/**
 * SPEC.md §9.4's measurements panel, at its one call site (UI-190).
 *
 * Asserted here rather than only in `CostPanel.test.tsx` because the placement
 * claim is that **one insertion serves every document**, and that is a property
 * of where `DocView` calls it rather than of the component. A second call site
 * added for conversations would pass every panel test and fail the second case
 * below in the way it is meant to.
 */
describe("where the measurements panel renders", () => {
  it("renders below the body, after the two link panels", async () => {
    const doc = docFixture({ frontmatter: { id: "doc_x", type: "note", title: "A note" } });
    /*
     * Both link panels are seeded with something to show, and that is what
     * makes the ordering assertion below mean anything: `Backlinks` and
     * `RelatedPanel` render `null` when empty, so against the default fixture
     * the filtered list holds one name and any order passes it. Verified by
     * moving the call site above `Backlinks` — the test only goes red with
     * these two seeded.
     */
    const wire = readerTransport({
      docs: [doc, docFixture({ frontmatter: { id: "doc_ref", title: "Refers here" } })],
      rows: {
        [threadsSearch("doc_x")]: [],
        [backlinksSearch("doc_x")]: [
          docRowFixture({ id: "doc_ref", title: "Refers here", type: "note" }),
        ],
      },
      related: { doc_x: [relatedFixture()] },
    });
    render(open(doc, wire));

    const panel = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".doc-body-slot .cost");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    // Last of the three, and inside the document half — never above the body,
    // where a late-arriving panel once moved it 77.86px mid-selection.
    const names = [...(panel.parentElement?.children ?? [])]
      .map((child) => child.className)
      .filter((name) => name === "backlinks" || name === "related" || name === "cost");
    expect(names).toEqual(["backlinks", "related", "cost"]);

    const editor = document.querySelector('[data-doc-editor="doc_x"]');
    expect(editor).not.toBeNull();
    expect(editor?.compareDocumentPosition(panel) ?? 0).toBeGreaterThan(0);
    expect(
      ((editor?.compareDocumentPosition(panel) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  /**
   * Threads are documents (SPEC.md §6) and the series route takes a `th_*` id,
   * so the conversation view gets the panel from the same call site — no second
   * component and no thread-specific branch.
   */
  it("renders on a conversation too, from the same call site", async () => {
    const threadDoc = docFixture({
      frontmatter: { id: "th_c", type: "thread", title: "A conversation" },
      body: "",
    });
    const wire = readerTransport({
      docs: [threadDoc],
      threads: [
        threadFixture({
          id: "th_c",
          title: "A conversation",
          turns: [
            { author: "user", ts: "2026-09-01T10:00:00.000Z", body: "one turn", model: null },
          ],
        }),
      ],
      rows: { [threadsSearch("th_c")]: [], [backlinksSearch("th_c")]: [] },
      cost: { th_c: costFixture() },
    });
    render(open(threadDoc, wire));

    await waitFor(() => {
      expect(document.querySelector(".doc-body-slot .cost")).not.toBeNull();
    });
    // The conversation's own series, keyed on the thread id — never rolled up
    // into a parent's, which §9.4 deliberately does not do.
    expect(wire.calls.some((call) => call.path === costPath("th_c"))).toBe(true);
    expect(document.querySelectorAll(".cost")).toHaveLength(1);
  });
});
