/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
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

function installPlugin(): void {
  setPluginRegistry(
    buildRegistry([
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
              ],
              columns: [],
            },
          },
        },
      },
    ]),
  );
}

function wireFor(doc: Doc): ReaderTransport {
  return readerTransport({
    docs: [doc],
    rows: { [threadsSearch(doc.frontmatter.id)]: [], [backlinksSearch(doc.frontmatter.id)]: [] },
  });
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
    expect(editorFor("doc_x")?.getAttribute("data-editable")).toBe("true");
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
    expect(editorFor("doc_fx")?.getAttribute("data-editable")).toBe("true");
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
