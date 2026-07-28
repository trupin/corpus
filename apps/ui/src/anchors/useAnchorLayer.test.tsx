/** @vitest-environment jsdom */
import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { Node as PmModelNode } from "@tiptap/pm/model";
import { EditorState, type Plugin } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginEditing, endEditing, resetEditingRegistry } from "../editor/editingRegistry.js";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { corpusSchema } from "../editor/markdown/schema.js";
import {
  readerTransport,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { anchorState } from "./anchorDecorations.js";
import { resetTraceCache } from "./traceCache.js";
import { REAPPLY_DEBOUNCE_MS, useAnchorLayer, type AnchorLayer } from "./useAnchorLayer.js";

/**
 * The layer's decisions, driven through a real `EditorState` — the anchor
 * plugin is really registered, the transactions really apply, and the requests
 * really go through the transport.
 *
 * The editor is a stand-in only for the parts that need a browser: a live
 * `EditorView` needs layout, and `coordsAtPos` is the one call the layer makes
 * that a DOM-less environment cannot answer.
 */

const BODY = "The rate assumption is 6.1% today.\n\nA second paragraph follows it.\n";

afterEach(() => {
  cleanup();
  resetTraceCache();
  resetEditingRegistry();
});

interface FakeEditor {
  readonly editor: Editor;
  state: () => EditorState;
  /** Replaces the whole document, carrying no meta of its own. */
  replace: (markdown: string) => void;
  /** The same replacement `DocEditor`'s `setContent(…, false)` dispatches. */
  adopt: (markdown: string) => void;
}

function fakeEditor(markdown: string): FakeEditor {
  let state = EditorState.create({
    doc: PmModelNode.fromJSON(corpusSchema(), parseMarkdown(markdown)),
  });
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (event: string, payload: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const editor = {
    get state() {
      return state;
    },
    get isDestroyed() {
      return false;
    },
    view: {
      dispatch: (transaction: ReturnType<EditorState["tr"]["setMeta"]>) => {
        state = state.apply(transaction);
      },
      coordsAtPos: () => ({ top: 100, bottom: 118, left: 40, right: 90 }),
    },
    registerPlugin: (plugin: Plugin) => {
      state = state.reconfigure({ plugins: [...state.plugins, plugin] });
    },
    unregisterPlugin: () => undefined,
    on: (event: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: (payload: unknown) => void) => {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as Editor;
  const dispatch = (transaction: ReturnType<EditorState["tr"]["setMeta"]>): void => {
    state = state.apply(transaction);
    emit("transaction", { editor, transaction });
  };
  (editor as unknown as { view: { dispatch: typeof dispatch } }).view.dispatch = dispatch;
  return {
    editor,
    state: () => state,
    replace: (next: string) => {
      const replacement = PmModelNode.fromJSON(corpusSchema(), parseMarkdown(next));
      dispatch(state.tr.replaceWith(0, state.doc.content.size, replacement.content));
    },
    adopt: (next: string) => {
      const replacement = PmModelNode.fromJSON(corpusSchema(), parseMarkdown(next));
      dispatch(
        state.tr
          .replaceWith(0, state.doc.content.size, replacement.content)
          // What `editor.commands.setContent(content, false)` marks it with.
          .setMeta("preventUpdate", true),
      );
    },
  };
}

function anchorFixture(overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  const start = BODY.indexOf("6.1%");
  return {
    anchorId: "anc_1",
    threadId: "th_1",
    threadStatus: "open",
    selector: { exact: "6.1%", prefix: "", suffix: "" },
    range: { start, end: start + 4 },
    orphaned: false,
    ...overrides,
  };
}

interface HostProps {
  readonly wire: ReaderTransport;
  readonly anchors: readonly ResolvedAnchor[];
  readonly threads: readonly DocRow[];
  readonly onLayer: (layer: AnchorLayer) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

function Host({ wire, anchors, threads, onLayer, onNotify }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  return (
    <harness.Wrapper>
      <Probe anchors={anchors} threads={threads} onLayer={onLayer} onNotify={onNotify} />
    </harness.Wrapper>
  );
}

function Probe({ anchors, threads, onLayer, onNotify }: Omit<HostProps, "wire">): ReactElement {
  const layer = useAnchorLayer({
    docId: "doc_m",
    body: BODY,
    anchors,
    threads,
    locked: false,
    editable: true,
    expandedThreads: [],
    onToggleThread: () => undefined,
    onNotify,
  });
  onLayer(layer);
  return <div ref={layer.mainRef} />;
}

interface Mounted {
  readonly wire: ReaderTransport;
  readonly layer: () => AnchorLayer;
  readonly notices: RowNotice[];
  readonly editorState: () => EditorState;
  readonly replaceDocument: (markdown: string) => void;
  readonly adoptDocument: (markdown: string) => void;
}

function mount(
  anchors: readonly ResolvedAnchor[] = [],
  threads: readonly DocRow[] = [],
  wire: ReaderTransport = readerTransport({}),
): Mounted {
  const notices: RowNotice[] = [];
  let current: AnchorLayer | null = null;
  const fake = fakeEditor(BODY);
  render(
    <Host
      wire={wire}
      anchors={anchors}
      threads={threads}
      onLayer={(layer) => {
        current = layer;
      }}
      onNotify={(notice) => {
        notices.push(notice);
      }}
    />,
  );
  act(() => {
    current?.onEditor(fake.editor);
  });
  return {
    wire,
    notices,
    editorState: fake.state,
    replaceDocument: fake.replace,
    adoptDocument: fake.adopt,
    layer: () => {
      if (current === null) throw new Error("not mounted");
      return current;
    },
  };
}

/** Opens the popover on the ProseMirror range showing `quote`. */
function selectQuote(layer: AnchorLayer, from: number, to: number): void {
  act(() => {
    layer.onComment({
      docId: "doc_m",
      from,
      to,
      text: "",
      body: BODY,
      range: null,
      selector: null,
    });
  });
}

/* `6.1%` is markdown offset 22–26, which is ProseMirror 23–27. */
const RATE_FROM = BODY.indexOf("6.1%") + 1;
const RATE_TO = RATE_FROM + 4;

describe("commenting on a selection", () => {
  it("opens a composer carrying the markdown quote", () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    expect(app.layer().draft?.selection.selector.exact).toBe("6.1%");
    expect(app.layer().draft?.top).toBe(124);
  });

  it("refuses a selection that quotes nothing, and says so", () => {
    const app = mount();
    selectQuote(app.layer(), 4, 4);
    expect(app.layer().draft).toBeNull();
    expect(app.notices[0]?.tone).toBe("error");
  });

  it("posts the shipped shape, with note-only as an explicit false", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Where is this from?", false);
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect(app.wire.of("POST", "/api/threads")[0]?.body).toEqual({
      parent: "doc_m",
      selector: {
        exact: "6.1%",
        prefix: "The rate assumption is ",
        suffix: " today.\n\nA second paragraph foll",
      },
      body: "Where is this from?",
      requestsAgent: false,
    });
  });

  it("asks the agent when the toggle says so", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Check this.", true);
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect(
      (app.wire.of("POST", "/api/threads")[0]?.body as { requestsAgent: boolean }).requestsAgent,
    ).toBe(true);
  });

  it("paints the highlight before the response lands, and clears it after", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false);
    });
    // Optimistic: the decoration is there while the request is in flight.
    const pending = anchorState(app.editorState())?.anchors ?? [];
    expect(pending).toHaveLength(1);
    expect(pending[0]?.segments).toEqual([{ from: RATE_FROM, to: RATE_TO }]);
    expect(pending[0]?.threadId.startsWith("pending:")).toBe(true);

    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors ?? []).toHaveLength(0);
    });
  });

  it("rolls the highlight back and toasts when the server refuses", async () => {
    const app = mount([], [], readerTransport({ failing: { "POST /api/threads": 409 } }));
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false);
    });
    expect(anchorState(app.editorState())?.anchors ?? []).toHaveLength(1);
    await waitFor(() => {
      expect(app.notices.some((notice) => notice.message.startsWith("Comment failed"))).toBe(true);
    });
    expect(anchorState(app.editorState())?.anchors ?? []).toHaveLength(0);
  });
});

describe("a comment submitted mid-save", () => {
  beforeEach(() => {
    resetEditingRegistry();
  });

  it("waits for the save to land before it posts", async () => {
    const app = mount();
    act(() => {
      beginEditing("doc_m");
    });
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Held.", false);
    });

    // Nothing on the wire: the server does not have the body this quote came
    // from yet.
    await act(async () => {
      await Promise.resolve();
    });
    expect(app.wire.of("POST", "/api/threads")).toHaveLength(0);

    act(() => {
      endEditing("doc_m");
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
  });
});

describe("the reconciliation report", () => {
  const row = threadRowFixture({ id: "th_1", parent: "doc_m", turnCount: 2 });

  it("orphans a thread the moment the save says so, with no refetch", async () => {
    const app = mount([anchorFixture()], [row]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toHaveLength(1);
    });
    expect(app.layer().orphaned).toHaveLength(0);

    act(() => {
      app.layer().onAnchors({
        docId: "doc_m",
        revision: 1,
        remapped: [],
        orphaned: ["anc_1"],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(app.layer().orphaned.map((thread) => thread.id)).toEqual(["th_1"]);
    });
    expect(app.layer().anchored[0]?.placement.segments).toEqual([]);
  });

  it("ignores a report from an older revision", async () => {
    const app = mount([anchorFixture()], [row]);
    act(() => {
      app.layer().onAnchors({
        docId: "doc_m",
        revision: 2,
        remapped: ["anc_1"],
        orphaned: [],
        warnings: [],
      });
    });
    act(() => {
      // Arrives later, describes an older body.
      app.layer().onAnchors({
        docId: "doc_m",
        revision: 1,
        remapped: [],
        orphaned: ["anc_1"],
        warnings: [],
      });
    });
    await waitFor(() => {
      expect(app.layer().anchored).toHaveLength(1);
    });
    expect(app.layer().orphaned).toHaveLength(0);
  });
});

describe("the highlights themselves", () => {
  it("are applied from the server's ranges once the editor holds that body", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors).toHaveLength(1);
    });
    expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
      { from: RATE_FROM, to: RATE_TO, block: 1 },
    ]);
  });

  it("are not applied against a document the offsets were not computed for", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors).toHaveLength(1);
    });
    const before = anchorState(app.editorState())?.anchors[0]?.segments;
    expect(before).toBeDefined();

    // The editor moves ahead of the server: the mapping keeps the highlight,
    // and no fresh server range is applied over the top of it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => {
      app.layer().onAnchors({
        docId: "doc_m",
        revision: 1,
        remapped: ["anc_1"],
        orphaned: [],
        warnings: [],
      });
    });
    expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual(before);
    spy.mockRestore();
  });
});

describe("a document replaced under the layer", () => {
  it("gets its highlights back, because a replacement maps every range to nothing", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toHaveLength(1);
    });

    // What `DocEditor` does when the server's copy moves on — including two
    // seconds after this document's own save, once the editing session settles.
    act(() => {
      app.replaceDocument(BODY);
    });
    // Collapsed to nothing by the mapping — retained, but drawing no highlight.
    const collapsed = anchorState(app.editorState())?.anchors[0]?.segments[0];
    expect(collapsed?.from).toBe(collapsed?.to);

    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
        { from: RATE_FROM, to: RATE_TO, block: 1 },
      ]);
    });
  });

  /**
   * The adoption that follows a save is the common case, and it does not get
   * to blink.
   *
   * `DocEditor` adopts the server's copy once the editing session settles —
   * often a commit or two after the body arrived, so the layer's own effect has
   * already run and only the transaction listener is left to repair the wipe.
   * On the debounce that is a visible flicker of every highlight in the
   * document; the adoption is marked, so it is repaired on this tick.
   */
  it("repairs an adoption of the server's copy without waiting out the debounce", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toHaveLength(1);
    });

    await act(async () => {
      app.adoptDocument(BODY);
      // One microtask — no timers advanced, nothing waited out.
      await Promise.resolve();
    });

    expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
      { from: RATE_FROM, to: RATE_TO, block: 1 },
    ]);
  });

  it("leaves a replacement it cannot vouch for alone", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toHaveLength(1);
    });
    act(() => {
      app.replaceDocument("Something else entirely.\n");
    });
    await new Promise((resolve) => setTimeout(resolve, REAPPLY_DEBOUNCE_MS * 3));
    // The offsets describe a body this is not: nothing is drawn, and nothing is
    // drawn in the wrong place either.
    const segment = anchorState(app.editorState())?.anchors[0]?.segments[0];
    expect(segment?.from).toBe(segment?.to);
  });
});
