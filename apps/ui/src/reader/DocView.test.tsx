/** @vitest-environment jsdom */
import type { Doc, DocRow } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRegistry, EMPTY_REGISTRY, setPluginRegistry } from "../plugins/registry";
import { resetSlotCache } from "../plugins/slots";
import {
  backlinksSearch,
  docFixture,
  readerTransport,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { Reader } from "./Reader";
import type { NavEntry } from "./useNavStack";
import { resetEscapeLayers } from "./useEscapeStack";

/**
 * Which renderer a document body gets (UI-014).
 *
 * Three outcomes in a fixed order — a thread's conversation, a plugin `View`,
 * and otherwise the always-editable editor — asserted through the real reader
 * rather than by calling the gate, because the whole finding was that the gate
 * and the call site disagreed about what "the core does not know this type"
 * should mean.
 */

const PLUGIN_TYPE = "fixture-note";

/** A doc type the plugin owns with a `DocPanel` — the slot that renders above the body. */
const PANEL_TYPE = "fixture-panelled";

const PLUGIN_DOC = docFixture({
  frontmatter: { id: "doc_fx", type: PLUGIN_TYPE, title: "A fixture note" },
  body: "The body a plugin owns.",
});

const UNKNOWN_DOC = docFixture({
  frontmatter: { id: "doc_x", type: "a-type-nothing-knows", title: "Unknown type" },
  body: "Prose nobody claims.",
});

const VIEW_DOC = docFixture({
  frontmatter: { id: "doc_v", type: "view", title: "A saved query" },
  body: "The description of a view.",
});

const PANEL_DOC = docFixture({
  frontmatter: { id: "doc_pn", type: PANEL_TYPE, title: "A panelled note" },
  body: "Prose with a plugin panel above it.",
});

/** A second panelled document, to navigate a reader onto and back from. */
const OTHER_PANEL_DOC = docFixture({
  frontmatter: { id: "doc_pn2", type: PANEL_TYPE, title: "Another panelled note" },
  body: "More prose with a panel of its own.",
});

/** The registry the fixture plugin produces once it has loaded. */
function fixtureRegistry(): ReturnType<typeof buildRegistry> {
  return buildRegistry([
    {
      dir: "fx",
      loaded: {
        module: {
          default: {
            id: "fx",
            name: "FX",
            docTypes: [
              {
                type: PLUGIN_TYPE,
                View: ({ doc }: { readonly doc: Doc }) => (
                  <p data-fx-view="">plugin view of {doc.frontmatter.title}</p>
                ),
              },
              {
                type: PANEL_TYPE,
                DocPanel: ({ doc }: { readonly doc: Doc }) => (
                  <p data-fx-panel="">panel over {doc.frontmatter.title}</p>
                ),
              },
            ],
            columns: [],
          },
        },
      },
    },
  ]);
}

function installPlugin(): void {
  setPluginRegistry(fixtureRegistry());
}

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

/**
 * The same reader, with a navigation stack the test can drive — a `[[ref]]`
 * followed and then Back. `open` above pins its stack, which is enough for
 * everything that renders one document; this is for what a reader carries
 * *across* documents, since it is not keyed by document id.
 */
let navigateTo: (docId: string) => void = () => undefined;
let goBack: () => void = () => undefined;

function Column({
  start,
  wire,
}: {
  readonly start: string;
  readonly wire: ReaderTransport;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  const [nav, setNav] = useState<readonly NavEntry[]>([{ docId: start, scrollY: 0 }]);
  navigateTo = (docId: string): void => {
    setNav([...nav, { docId, scrollY: 0 }]);
  };
  goBack = (): void => {
    setNav(nav.slice(0, -1));
  };
  return (
    <harness.Wrapper>
      <div className="col reading">
        <Reader
          columnId="doc_col"
          columnTitle="Finance"
          nav={nav}
          setNav={setNav}
          selectTitle={false}
          isActive
          onFocusMode={() => undefined}
          onNotify={() => undefined}
        />
      </div>
    </harness.Wrapper>
  );
}

beforeEach(() => {
  resetSlotCache();
});

afterEach(() => {
  cleanup();
  setPluginRegistry(EMPTY_REGISTRY);
  resetSlotCache();
  resetEscapeLayers();
});

const editorFor = (docId: string): Element | null =>
  document.querySelector(`[data-doc-editor="${docId}"]`);

describe("the body renderer a document gets", () => {
  it("gives an unknown type the editable editor, exactly like a core note", async () => {
    render(open(UNKNOWN_DOC, wireFor(UNKNOWN_DOC)));
    await waitFor(() => {
      expect(editorFor("doc_x")).not.toBeNull();
    });
    expect(editorFor("doc_x")?.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(screen.getByText("Prose nobody claims.")).toBeTruthy();
  });

  it("gives a plugin type its plugin's View when the plugin is installed", async () => {
    installPlugin();
    render(open(PLUGIN_DOC, wireFor(PLUGIN_DOC)));
    await waitFor(() => {
      expect(screen.getByText("plugin view of A fixture note")).toBeTruthy();
    });
    // The plugin owns its whole body surface: no editor underneath it.
    expect(editorFor("doc_fx")).toBeNull();
  });

  /**
   * SPEC.md §10's deletion safety. Removing the plugin removes its chrome, not
   * the user's ability to fix a typo in a document they still own.
   */
  it("flips the same document to the editor when the plugin is gone", async () => {
    setPluginRegistry(EMPTY_REGISTRY);
    render(open(PLUGIN_DOC, wireFor(PLUGIN_DOC)));
    await waitFor(() => {
      expect(editorFor("doc_fx")).not.toBeNull();
    });
    expect(screen.queryByText(/plugin view of/)).toBeNull();
    expect(editorFor("doc_fx")?.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(screen.getByText("The body a plugin owns.")).toBeTruthy();
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
 * UI-073 — what the reader does while plugin discovery is still in flight.
 *
 * The geometry itself is jsdom's blind spot, so the pixels are pinned in
 * `e2e/plugin-late-arrival.spec.ts` (77.86px, in a real browser). What is
 * asserted here is the *rule* that makes the shift impossible: no part of the
 * document body reaches the DOM while discovery is pending, so there is never a
 * frame in which a panel or a `View` can arrive over something already painted.
 */
describe("a reader open while plugin discovery is in flight", () => {
  it("paints no body at all — nothing on screen for a late panel to move", async () => {
    setPluginRegistry(EMPTY_REGISTRY, "pending");
    render(open(PANEL_DOC, wireFor(PANEL_DOC)));
    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(editorFor("doc_pn")).toBeNull();
    expect(document.querySelector("[data-fx-panel]")).toBeNull();
  });

  it("brings the panel and the body in together when discovery settles", async () => {
    setPluginRegistry(EMPTY_REGISTRY, "pending");
    render(open(PANEL_DOC, wireFor(PANEL_DOC)));
    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeTruthy();
    });

    setPluginRegistry(fixtureRegistry());
    await waitFor(() => {
      expect(editorFor("doc_pn")).not.toBeNull();
    });
    // The same commit: the body's first appearance already has the panel above
    // it, which is the whole property. A body that arrived first would have
    // moved when this appeared.
    expect(document.querySelector("[data-fx-panel]")).not.toBeNull();
  });

  /**
   * A plugin `View` is the same defect with a bigger jump — it replaces the
   * body wholesale — and reserving a slot's height could never have covered it.
   */
  it("never shows the core editor under a document a plugin View owns", async () => {
    setPluginRegistry(EMPTY_REGISTRY, "pending");
    render(open(PLUGIN_DOC, wireFor(PLUGIN_DOC)));
    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(editorFor("doc_fx")).toBeNull();

    setPluginRegistry(fixtureRegistry());
    await waitFor(() => {
      expect(screen.getByText("plugin view of A fixture note")).toBeTruthy();
    });
    expect(editorFor("doc_fx")).toBeNull();
  });

  /**
   * The bound (`DISCOVERY_BUDGET_MS`). Past it the document is worth more than
   * the chrome, so the body paints — and then it is *kept* unadorned, because
   * a panel arriving over a body that is already on screen is the defect
   * itself, merely later.
   */
  it("paints without plugin chrome once the wait is abandoned, and keeps it that way", async () => {
    setPluginRegistry(EMPTY_REGISTRY, "abandoned");
    render(open(PANEL_DOC, wireFor(PANEL_DOC)));
    await waitFor(() => {
      expect(editorFor("doc_pn")).not.toBeNull();
    });
    expect(document.querySelector("[data-fx-panel]")).toBeNull();

    setPluginRegistry(fixtureRegistry());
    await waitFor(() => {
      expect(editorFor("doc_pn")?.querySelector('[contenteditable="true"]')).not.toBeNull();
    });
    expect(document.querySelector("[data-fx-panel]")).toBeNull();
  });

  /**
   * And *only* that body (PR #22 review, MINOR). A reader is not keyed by
   * document id, so it outlives every navigation in its stack: the suppression
   * belongs to the painted body, not to the component, or a document opened
   * long after discovery settled would be drawn blind for the life of the
   * column — a bug wearing the fix's clothes.
   */
  it("paints the next document's chrome, and the same document's on the way Back", async () => {
    setPluginRegistry(EMPTY_REGISTRY, "abandoned");
    render(<Column start="doc_pn" wire={wireFor(PANEL_DOC, OTHER_PANEL_DOC)} />);
    await waitFor(() => {
      expect(editorFor("doc_pn")).not.toBeNull();
    });
    expect(document.querySelector("[data-fx-panel]")).toBeNull();

    // Discovery finishes late — too late for the body already on screen.
    setPluginRegistry(fixtureRegistry());
    await waitFor(() => {
      expect(editorFor("doc_pn")).not.toBeNull();
    });
    expect(document.querySelector("[data-fx-panel]")).toBeNull();

    // A `[[ref]]` followed in the same reader: nothing of this document is on
    // screen to be moved, so its panel arrives with its first paint.
    act(() => {
      navigateTo("doc_pn2");
    });
    await waitFor(() => {
      expect(screen.getByText("panel over Another panelled note")).toBeTruthy();
    });

    // And Back onto the document that was painted blind, which is a first paint
    // too — the suppression died with the body it described.
    act(() => {
      goBack();
    });
    await waitFor(() => {
      expect(screen.getByText("panel over A panelled note")).toBeTruthy();
    });
  });
});
