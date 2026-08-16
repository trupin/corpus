/** @vitest-environment jsdom */
import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { Node as PmModelNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Plugin } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginEditing, endEditing, resetEditingRegistry } from "../editor/editingRegistry.js";
import { editorBody } from "../editor/editorBody.js";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { canonicalizeMarkdown } from "../editor/markdown/serialize.js";
import { STALE_SELECTION_NOTICE, type TextQuoteSelector } from "../editor/selection.js";
import type { PendingAttachment } from "@corpus/kit";
import { corpusSchema } from "../editor/markdown/schema.js";
import {
  readerTransport,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { anchorState } from "./anchorDecorations.js";
import { mdRangeToPm } from "./offsetMap.js";
import { resetTraceCache, traceOfBody } from "./traceCache.js";
import {
  REAPPLY_DEBOUNCE_MS,
  REFUSAL_NOTICE,
  useAnchorLayer,
  type AnchorLayer,
} from "./useAnchorLayer.js";

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
  /** One ordinary edit: what typing into the body dispatches. */
  insert: (at: number, text: string) => void;
  /** The same replacement `DocEditor`'s `setContent(…, false)` dispatches. */
  adopt: (markdown: string) => void;
}

/**
 * What `DocEditor` actually parses: its `canonical` memo, never the raw body
 * (`content: parseMarkdown(canonical)`).
 *
 * The distinction is not pedantry — it is UI-099. Modelling the editor as
 * holding `parse(body)` quietly assumed `canonicalizeMarkdown` was idempotent,
 * so a document where it is not looked fine here and drew no highlight at all
 * in a browser. Every `fromJSON` below goes through this for that reason.
 */
function editorDocument(markdown: string): PmModelNode {
  return PmModelNode.fromJSON(corpusSchema(), parseMarkdown(editorBody(markdown)));
}

function fakeEditor(markdown: string): FakeEditor {
  let state = EditorState.create({ doc: editorDocument(markdown) });
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
      const replacement = editorDocument(next);
      dispatch(state.tr.replaceWith(0, state.doc.content.size, replacement.content));
    },
    insert: (at: number, text: string) => {
      dispatch(state.tr.insertText(text, at));
    },
    adopt: (next: string) => {
      const replacement = editorDocument(next);
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

/** What `GET /api/docs/{id}` answers with: a body, and the offsets into it. */
interface ServedDocument {
  readonly body: string;
  readonly anchors: readonly ResolvedAnchor[];
}

interface HostProps {
  readonly wire: ReaderTransport;
  readonly served: ServedDocument;
  readonly threads: readonly DocRow[];
  readonly onLayer: (layer: AnchorLayer) => void;
  readonly onNotify: (notice: RowNotice) => void;
  /** Publishes the setter, so a test can move the server's copy on. */
  readonly onServe: (serve: (next: ServedDocument) => void) => void;
}

function Host({ wire, served, threads, onLayer, onNotify, onServe }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  const [current, setCurrent] = useState(served);
  onServe(setCurrent);
  return (
    <harness.Wrapper>
      <Probe served={current} threads={threads} onLayer={onLayer} onNotify={onNotify} />
    </harness.Wrapper>
  );
}

function Probe({
  served,
  threads,
  onLayer,
  onNotify,
}: Omit<HostProps, "wire" | "onServe">): ReactElement {
  const layer = useAnchorLayer({
    docId: "doc_m",
    body: served.body,
    anchors: served.anchors,
    threads,
    threadsSettled: true,
    editable: true,
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
  /** Types into the body, the way a person does. */
  readonly typeInto: (at: number, text: string) => void;
  /** The server's copy moves on: a new body, and the anchors that index it. */
  readonly serveDocument: (next: ServedDocument) => void;
}

function mount(
  anchors: readonly ResolvedAnchor[] = [],
  threads: readonly DocRow[] = [],
  wire: ReaderTransport = readerTransport({}),
  /** The file on disk. Not always what the editor prints for it — see UI-068. */
  body: string = BODY,
): Mounted {
  const notices: RowNotice[] = [];
  let current: AnchorLayer | null = null;
  let serve: ((next: ServedDocument) => void) | null = null;
  const fake = fakeEditor(body);
  render(
    <Host
      wire={wire}
      served={{ body, anchors }}
      threads={threads}
      onLayer={(layer) => {
        current = layer;
      }}
      onServe={(setter) => {
        serve = setter;
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
    typeInto: fake.insert,
    serveDocument: (next) => {
      act(() => {
        serve?.(next);
      });
    },
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

/**
 * Where the composer's own highlight is, read out of the plugin — `null` when
 * nothing is lit.
 *
 * Read from the *decoration set* rather than from the state field beside it,
 * because a range the plugin remembers and does not draw is exactly the failure
 * this feature is about.
 */
function provisional(app: Mounted): { from: number; to: number } | null {
  const decorations = (anchorState(app.editorState())?.set.find() ?? []).filter(
    (decoration) =>
      (decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs?.[
        "data-provisional"
      ] === "true",
  );
  const only = decorations[0];
  return only === undefined ? null : { from: only.from, to: only.to };
}

/* `6.1%` is markdown offset 22–26, which is ProseMirror 23–27. */
const RATE_FROM = BODY.indexOf("6.1%") + 1;
const RATE_TO = RATE_FROM + 4;

/** What a composer hands over on send — the shape `intake.take()` returns. */
function attachment(name: string): PendingAttachment {
  return {
    id: `att-${name}`,
    file: new File(["x"], name, { type: "image/png" }),
    name,
    previewUrl: null,
  };
}

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
    expect(app.notices[0]).toEqual({ tone: "error", message: REFUSAL_NOTICE["no-quote"] });
  });

  /**
   * The other refusal, and the one only this layer can produce (UI-068).
   *
   * `selectorFromSelection` decides it, but what makes it reachable is
   * `quotableSource`: with no unsaved edits the quote is framed against the
   * **file's own bytes**, not the editor's printing of them. On a document whose
   * file spelling differs from the printer's — here `__sixty__`, which the
   * editor shows as `**sixty**` — the framed quote is a string no file contains,
   * so the layer refuses rather than opening a composer that would create a
   * thread anchored to a document that does not exist.
   *
   * Pinned here because this is the only place `REFUSAL_NOTICE["not-in-file"]`
   * is read: `selectorFromSelection.test.ts` proves the *reason* is produced,
   * and nothing else proves the layer turns it into that sentence.
   */
  it("refuses, distinctly, when the file cannot spell the selection", () => {
    // A soft line break inside an inline code span, which the printer flattens
    // to a space (UI-104's largest category, 51 of the repo's own documents).
    // The words on screen are real; the file spells them across two lines, so
    // there is no byte range of the file that is the selection.
    const FILE = "Run `corpus init\n--port 8791` first.\n\nA second paragraph follows it here.\n";
    const app = mount([], [], readerTransport({}), FILE);
    const live = traceOfBody(editorBody(FILE));
    const QUOTE = "init --port";
    expect(live.markdown).toContain(QUOTE);
    expect(FILE).not.toContain(QUOTE);
    const start = live.markdown.indexOf(QUOTE);
    const pm = mdRangeToPm(live.trace, { start, end: start + QUOTE.length });
    selectQuote(app.layer(), pm[0]?.from ?? 0, pm.at(-1)?.to ?? 0);

    expect(app.layer().draft).toBeNull();
    expect(app.notices[0]).toEqual({ tone: "error", message: REFUSAL_NOTICE["not-in-file"] });
    expect(app.notices[0]?.message).not.toBe(REFUSAL_NOTICE["no-quote"]);
  });

  it("posts the shipped shape, with note-only as an explicit false", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Where is this from?", false, {});
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

  /**
   * SPEC.md §11's rider, signed 2026-08-05: a comment on a document selection
   * carries files like every other composer, and carrying them is what makes
   * the request multipart (§6). Asserted on the **wire**, because a composer
   * that collects attachments and a layer that drops them on the way out is the
   * same bug from the outside (UI-111).
   */
  it("posts a comment's attachments as multipart, with an omitted text part", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      // §6: a first turn may be the file and nothing else.
      app.layer().submitComment("", true, {}, [attachment("shot.png")]);
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    const call = app.wire.of("POST", "/api/threads")[0];
    expect(call?.files).toEqual(["shot.png"]);
    expect(call?.parts?.["text"]).toBeUndefined();
    expect(call?.parts?.["selector"]).toContain("6.1%");
    expect(call?.parts?.["requestsAgent"]).toBe("true");
  });

  /** And the JSON branch is untouched: no attachments, no multipart. */
  it("posts a comment carrying no files as JSON", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Just words.", true, {}, []);
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    const call = app.wire.of("POST", "/api/threads")[0];
    expect(call?.files).toBeUndefined();
    expect((call?.body as { body: string }).body).toBe("Just words.");
  });

  /**
   * The failure ThreadComposer has always handled and this surface did not:
   * nothing was written, so the composer comes back holding what it held. A
   * comment that loses its screenshot because the post failed is worse than one
   * that could never take it (UI-111).
   */
  it("re-opens the composer with its words and its files when the server refuses", async () => {
    const app = mount([], [], readerTransport({ failing: { "POST /api/threads": 409 } }));
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    const held = attachment("shot.png");
    act(() => {
      app.layer().submitComment("Look at this.", true, {}, [held]);
    });
    // Gone while it is in flight, exactly as the reply box empties on send.
    expect(app.layer().draft).toBeNull();

    await waitFor(() => {
      expect(app.layer().draft).not.toBeNull();
    });
    expect(app.layer().draft?.restore).toEqual({
      text: "Look at this.",
      attachments: [held],
    });
    // And on the same selection, so re-sending anchors where it was written.
    expect(app.layer().draft?.selection.selector.exact).toBe("6.1%");
  });

  /** A second send must not carry the first refusal's leftovers as well. */
  it("does not re-restore a draft that has already been resubmitted", async () => {
    const app = mount([], [], readerTransport({ failing: { "POST /api/threads": 409 } }));
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Once.", true, {}, [attachment("shot.png")]);
    });
    await waitFor(() => {
      expect(app.layer().draft?.restore).not.toBeUndefined();
    });
    act(() => {
      app.layer().submitComment("Twice.", true, {}, []);
    });
    await waitFor(() => {
      expect(app.layer().draft?.restore).toEqual({ text: "Twice.", attachments: [] });
    });
  });

  /**
   * SPEC.md §11's rider: the composer states the weight, and the layer is what
   * puts it on the request. Absence stays absence — an untouched picker sends
   * `{}` and the body must not grow a `weight` key from it (UI-082).
   */
  it("carries a stated weight onto the comment's request, and nothing when none", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Heavy, please.", true, { weight: "heavy" });
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect((app.wire.of("POST", "/api/threads")[0]?.body as { weight?: string }).weight).toBe(
      "heavy",
    );

    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("No weight.", true, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(2);
    });
    expect("weight" in (app.wire.of("POST", "/api/threads")[1]?.body as object)).toBe(false);
  });

  it("asks the agent when the toggle says so", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("Check this.", true, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect(
      (app.wire.of("POST", "/api/threads")[0]?.body as { requestsAgent: boolean }).requestsAgent,
    ).toBe(true);
  });

  /**
   * UI-112. The complaint was that the highlight arrived with the *anchor* —
   * after the comment had been posted, which is the moment it stops being
   * useful. While composing, the browser's own selection was all there was, and
   * it is gone the moment focus reaches the composer.
   */
  it("lights the selection the moment the composer opens, before anything is sent", () => {
    const app = mount();
    expect(provisional(app)).toBeNull();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    expect(provisional(app)).toEqual({ from: RATE_FROM, to: RATE_TO });
    expect(app.editorState().doc.textBetween(RATE_FROM, RATE_TO)).toBe("6.1%");
    expect(app.wire.of("POST", "/api/threads")).toHaveLength(0);
  });

  it("puts it out when the comment is abandoned, leaving nothing behind", () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().cancelComment();
    });
    expect(provisional(app)).toBeNull();
    expect(anchorState(app.editorState())?.set.find()).toHaveLength(0);
  });

  /** A position and a highlight are both per-opening: the next selection wins. */
  it("moves the mark to a second selection rather than lighting both", () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    const other = { from: 1, to: 5 };
    selectQuote(app.layer(), other.from, other.to);
    expect(provisional(app)).toEqual(other);
  });

  /**
   * The reconcile half of UI-112's ProseMirror decision, through the layer:
   * typing above the quote — what someone does when the comment is about to say
   * "as I wrote above" — moves the mark with its words rather than leaving it
   * over whatever slid into those offsets.
   */
  it("keeps the mark on its words when the document is edited above them", () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    app.typeInto(1, "Note: ");
    const moved = provisional(app);
    expect(moved).not.toBeNull();
    expect(moved).not.toEqual({ from: RATE_FROM, to: RATE_TO });
    expect(app.editorState().doc.textBetween(moved?.from ?? 0, moved?.to ?? 0)).toBe("6.1%");
  });

  /**
   * The case the server's own offsets can never cover, and the reason this
   * highlight is a slot of its own rather than one more placement: while the
   * editor holds unsaved edits `applyAnchors` declines every dispatch, because
   * the server's ranges index a body that is no longer on screen. A comment
   * written *during* an editing session is precisely when the words most need
   * marking — and routing it through that gate left it dark.
   */
  it("lights the selection even while the editor holds unsaved edits", () => {
    const app = mount();
    app.replaceDocument("The rate assumption is 6.1% today, revised.\n\nAnd a second one.\n");
    const from = app.editorState().doc.textContent.indexOf("6.1%") + 1;
    selectQuote(app.layer(), from, from + 4);
    expect(app.layer().draft).not.toBeNull();
    expect(provisional(app)).toEqual({ from, to: from + 4 });
  });

  it("paints the highlight before the response lands, and clears it after", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    // The decoration is there while the request is in flight — the same one the
    // composer put up on open, now waiting for the server's anchor.
    expect(provisional(app)).toEqual({ from: RATE_FROM, to: RATE_TO });

    await waitFor(() => {
      expect(provisional(app)).toBeNull();
    });
  });

  /**
   * It used to roll back, and rolling back was wrong (UI-112). Nothing was
   * written, so the composer comes back on the same words (UI-111) — and a
   * composer whose subject is unlit is the complaint this issue is about. The
   * mark is the composer's, not the request's, so it outlives a refused send
   * exactly as the typed words do.
   */
  it("keeps the words lit and toasts when the server refuses, because the composer returns", async () => {
    const app = mount([], [], readerTransport({ failing: { "POST /api/threads": 409 } }));
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    expect(provisional(app)).toEqual({ from: RATE_FROM, to: RATE_TO });
    await waitFor(() => {
      expect(app.notices.some((notice) => notice.message.startsWith("Comment failed"))).toBe(true);
    });
    expect(app.layer().draft).not.toBeNull();
    expect(provisional(app)).toEqual({ from: RATE_FROM, to: RATE_TO });

    // And abandoning it there does leave nothing behind.
    act(() => {
      app.layer().cancelComment();
    });
    expect(provisional(app)).toBeNull();
  });

  /**
   * SERVER-071 made a quote naming more than one passage a `400`, and the
   * sentence it refuses with asks the caller to send `prefix`/`suffix` copied
   * out of the file. This layer already does that — so reaching the refusal
   * means even the framed quote repeats, and repeating the server's instruction
   * to someone holding a mouse is an error message that cannot be acted on.
   */
  it("says something a reader can act on when the server calls the quote ambiguous", async () => {
    const app = mount([], [], readerTransport({ failing: { "POST /api/threads": 400 } }));
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    await waitFor(() => {
      expect(app.notices).toHaveLength(1);
    });
    expect(app.notices[0]?.message).toContain("appears more than once");
    expect(app.notices[0]?.message).toContain("select a longer stretch");
    expect(app.notices[0]?.message).not.toContain("prefix");
  });
});

/**
 * UI-068, through the whole layer: the quote the wire carries is bytes of the
 * **file**, on a file the editor prints differently from how it is stored.
 *
 * The fixture is the reported one — a padded table, under the blank line every
 * editor leaves after the frontmatter fence. Both constructs are before the
 * selection, so both used to shift the quote's context onto text that is not in
 * the document, and §6's rung 1 had nothing to match.
 */
describe("commenting on a file the editor would print differently", () => {
  const FILE =
    "\n# Standup\n\n| who | area |\n| --- | ---- |\n| Fernando | platform |\n" +
    "| Mesbah | infra |\n\n**Moushmi Verma** wrote it up on Monday.\n";
  const QUOTE = "Moushmi Verma** wrote it up";

  /** The ProseMirror range showing `QUOTE`, where a user's drag would leave it. */
  function selection(): { from: number; to: number } {
    const live = traceOfBody(FILE);
    const start = live.markdown.indexOf(QUOTE);
    const pm = mdRangeToPm(live.trace, { start, end: start + QUOTE.length });
    return { from: pm[0]?.from ?? 0, to: pm.at(-1)?.to ?? 0 };
  }

  it("sends a selector the file literally contains", async () => {
    const app = mount([], [], readerTransport({}), FILE);
    const { from, to } = selection();
    selectQuote(app.layer(), from, to);
    act(() => {
      app.layer().submitComment("Who is Mesbah?", false, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    const { selector } = app.wire.of("POST", "/api/threads")[0]?.body as {
      selector: TextQuoteSelector;
    };
    expect(selector.exact).toBe(QUOTE);
    // Rung 1 of §6's ladder — the rung SERVER-071 leaves to the caller, because
    // it locates the anchor by the `exact` the caller sent.
    expect(FILE).toContain(selector.prefix + selector.exact + selector.suffix);
    // And what used to be sent instead: the printer's aligned cells, which are
    // in no file anywhere.
    expect(traceOfBody(FILE).markdown).toContain("| Mesbah   | infra    |");
    expect(selector.prefix).not.toContain("Mesbah   ");
  });

  it("shows the composer the file's own quote", () => {
    const app = mount([], [], readerTransport({}), FILE);
    const { from, to } = selection();
    selectQuote(app.layer(), from, to);
    expect(app.layer().draft?.selection.selector.exact).toBe(QUOTE);
  });
});

/**
 * The document class UI-099 found, after UI-103 took the disagreement away.
 *
 * Printing this body once used to drop the blank line before the outer item's
 * trailing paragraph, and printing *that* re-read the paragraph as a
 * continuation of the **nested** item, indenting it 2 → 4 spaces. So the
 * editor's own document printed text `traceOfBody(body)` never produced, the
 * layer read the structural disagreement as "the editor holds unsaved edits",
 * and a seam-spanning selection put `exact: "bullet two.\n    A trailing
 * paragraph"` on the wire — four spaces the file does not contain, so
 * `body.includes(exact)` is false, §6's ladder has nothing to match at any rung,
 * and the comment is orphaned at creation (UI-068's failure exactly). UI-099
 * turned that into a visible refusal; **UI-103 removed the seam**, so there is
 * nothing left to refuse and the whole document comments normally again.
 *
 * That is what is asserted here, and it is the acceptance criterion of UI-103
 * read from the user's side: the file is a fixed point of the printer, a
 * selection spanning the boundary the two printings used to disagree about is
 * accepted, and the quote it puts on the wire is the file's own bytes.
 */
describe("commenting on a file whose two printings used to disagree about structure", () => {
  const FILE =
    "- Outer bullet leads in.\n" +
    "  - Nested bullet one.\n" +
    "  - Nested bullet two.\n" +
    "\n" +
    "  A trailing paragraph of the outer item.\n" +
    "- Second outer bullet.\n";

  /** The ProseMirror range showing `quote` in the document the editor holds. */
  function selection(quote: string): { from: number; to: number } {
    // `parse(canonicalizeMarkdown(body))` is what `DocEditor` builds and what
    // `editorDocument` above builds; this is its printing.
    const live = traceOfBody(editorBody(FILE));
    const start = live.markdown.indexOf(quote);
    expect(start).toBeGreaterThanOrEqual(0);
    const pm = mdRangeToPm(live.trace, { start, end: start + quote.length });
    return { from: pm[0]?.from ?? 0, to: pm.at(-1)?.to ?? 0 };
  }

  it("has no seam left to straddle: the file is what both printings say", () => {
    // The old failure, spelled out so a regression names it: the printer used to
    // reach this text on its second pass, and it is in no file.
    const OLD_SEAM = "bullet two.\n    A trailing paragraph";
    expect(FILE).not.toContain(OLD_SEAM);
    expect(canonicalizeMarkdown(FILE)).toBe(FILE);
    expect(canonicalizeMarkdown(canonicalizeMarkdown(FILE))).toBe(FILE);
    expect(canonicalizeMarkdown(FILE)).not.toContain(OLD_SEAM);
  });

  it("quotes the file for a selection across the boundary that used to be a seam", async () => {
    // Spans what the two printings disagreed about: the end of the last nested
    // bullet through the start of the outer item's trailing paragraph. This was
    // refused with `REFUSAL_NOTICE["not-in-file"]` until the printer agreed with
    // itself; now it is an ordinary selection.
    const QUOTE = "bullet two.\n\n  A trailing paragraph";
    const app = mount([], [], readerTransport({}), FILE);
    const { from, to } = selection(QUOTE);
    selectQuote(app.layer(), from, to);

    expect(app.notices).toHaveLength(0);
    expect(app.layer().draft).not.toBeNull();

    act(() => {
      app.layer().submitComment("Does this still straddle anything?", false, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    const { selector } = app.wire.of("POST", "/api/threads")[0]?.body as {
      selector: TextQuoteSelector;
    };
    // §6's rung 1: what went on the wire is in the file, byte for byte.
    expect(FILE).toContain(selector.prefix + selector.exact + selector.suffix);
    expect(selector.exact).toContain("bullet two.");
    expect(selector.exact).toContain("A trailing paragraph");
  });

  it("still quotes the file itself for a selection clear of the seam", async () => {
    const QUOTE = "Outer bullet leads in.";
    const app = mount([], [], readerTransport({}), FILE);
    const { from, to } = selection(QUOTE);
    selectQuote(app.layer(), from, to);
    expect(app.notices).toHaveLength(0);
    expect(app.layer().draft?.selection.selector.exact).toBe(QUOTE);

    act(() => {
      app.layer().submitComment("Is this still true?", false, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
    const { selector } = app.wire.of("POST", "/api/threads")[0]?.body as {
      selector: TextQuoteSelector;
    };
    expect(selector.exact).toBe(QUOTE);
    // §6's rung 1, against the bytes the server actually holds.
    expect(FILE).toContain(selector.prefix + selector.exact + selector.suffix);
  });
});

/**
 * The seam the right-click menu comments through (UI-024, SPEC.md §11).
 *
 * "Comment on selection" is 💬's own act reached by another gesture, so it goes
 * through this layer rather than beside it. What has to hold is that the range
 * is read when the **menu opens**: opening one moves focus out of the body and
 * collapses the caret, and a composer anchored to wherever the selection ended
 * up would quote the wrong words.
 */
describe("capturing the live selection as a comment", () => {
  function select(layer: AnchorLayer, from: number, to: number): void {
    const editor = layer.editor;
    if (editor === null) throw new Error("no editor");
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
      );
    });
  }

  it("comments on the range the menu opened over, not on the caret at activation", () => {
    const app = mount();
    select(app.layer(), RATE_FROM, RATE_TO);
    const comment = app.layer().captureComment();
    expect(comment).not.toBeNull();

    // The menu takes focus: the selection collapses somewhere else entirely.
    select(app.layer(), 4, 4);
    act(() => {
      comment?.();
    });

    expect(app.layer().draft?.selection.selector.exact).toBe("6.1%");
  });

  it.each([
    ["nothing is selected", 4, 4],
    ["the selection is whitespace", BODY.indexOf("6.1%") + 5, BODY.indexOf("6.1%") + 6],
  ])("offers nothing to comment on when %s", (_case, from, to) => {
    const app = mount();
    select(app.layer(), from, to);
    expect(app.layer().captureComment()).toBeNull();
  });

  /**
   * PR #13 review, MINOR. The menu can sit open while the agent's write arrives
   * and `DocEditor` adopts a new body; the captured positions then quote other
   * words — the one failure this layer exists to prevent — or point past the end
   * of a document that shrank, which throws out of `textBetween`.
   */
  it("refuses when the words at those positions changed under the open menu", () => {
    const app = mount();
    select(app.layer(), RATE_FROM, RATE_TO);
    const comment = app.layer().captureComment();

    act(() => {
      app.replaceDocument("The rate assumption is 9.9% today.\n\nA second paragraph follows it.\n");
    });
    act(() => {
      comment?.();
    });

    expect(app.layer().draft).toBeNull();
    expect(app.notices.at(-1)).toEqual({
      tone: "error",
      message: STALE_SELECTION_NOTICE,
    });
  });

  it("refuses on a document that shrank past the captured range", () => {
    const app = mount();
    select(app.layer(), RATE_FROM, RATE_TO);
    const comment = app.layer().captureComment();

    act(() => {
      app.replaceDocument("Hi.\n");
    });
    // No throw, and no draft opened on positions the document no longer has.
    act(() => {
      comment?.();
    });

    expect(app.layer().draft).toBeNull();
    expect(app.notices.at(-1)?.message).toBe(STALE_SELECTION_NOTICE);
  });

  it("still comments when the change left those words where they were", () => {
    const app = mount();
    select(app.layer(), RATE_FROM, RATE_TO);
    const comment = app.layer().captureComment();

    act(() => {
      app.replaceDocument("The rate assumption is 6.1% today.\n\nA rewritten second paragraph.\n");
    });
    act(() => {
      comment?.();
    });

    expect(app.layer().draft?.selection.selector.exact).toBe("6.1%");
  });
});

/**
 * The outcome of a comment the reader did not stay open for (UI-015).
 *
 * A per-call `onSuccess`/`onError` is delivered through the mutation's observer
 * and skipped once that observer has no listeners left — pinned as library
 * behaviour by the kit's own `writeHooks.test.tsx` → "callbacks and observer
 * teardown". So the warnings and the failure notice ride on the **hook**, and
 * clearing the optimistic highlight — the half that means nothing once the layer
 * is gone — deliberately does not.
 */
describe("a comment whose reader closed before it settled", () => {
  /** A write held open until the test lets it answer (UI-012's gate). */
  function gate(): { readonly held: Promise<void>; readonly release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    return { held, release: () => release() };
  }

  /** Submits a comment and waits for the request to be on the wire, unanswered. */
  async function submitAndHold(app: Mounted): Promise<void> {
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    await waitFor(() => {
      expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    });
  }

  it("still surfaces the server's warnings, one toast each", async () => {
    const { held, release } = gate();
    const app = mount(
      [],
      [],
      readerTransport({
        holdWrites: held,
        threadWarnings: [
          { code: "unresolved_ref", detail: "[[missing]] names no document" },
          { code: "commit_skipped", detail: "no git in this workspace" },
        ],
      }),
    );
    await submitAndHold(app);

    cleanup();
    release();

    await waitFor(() => {
      expect(app.notices).toHaveLength(2);
    });
    expect(app.notices).toEqual([
      { tone: "error", message: "unresolved_ref — [[missing]] names no document" },
      { tone: "error", message: "commit_skipped — no git in this workspace" },
    ]);
  });

  it("still surfaces the failure, with the server's message intact", async () => {
    const { held, release } = gate();
    const app = mount(
      [],
      [],
      readerTransport({ holdWrites: held, failing: { "POST /api/threads": 409 } }),
    );
    await submitAndHold(app);

    cleanup();
    release();

    await waitFor(() => {
      expect(app.notices).toHaveLength(1);
    });
    expect(app.notices[0]).toEqual({
      tone: "error",
      message: "Comment failed — the server refused",
    });
  });

  /**
   * The other half of the split: the optimistic chip is local state, so clearing
   * it after the layer has gone is meaningless work on a dead component. It
   * stays on `mutate`, where being skipped is the correct outcome — and the
   * decoration the layer painted is therefore still exactly where teardown left
   * it, untouched by the response.
   */
  it("attempts no cleanup on the layer it no longer has", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { held, release } = gate();
    const app = mount([], [], readerTransport({ holdWrites: held }));
    await submitAndHold(app);
    const painted = provisional(app);
    expect(painted).not.toBeNull();

    cleanup();
    release();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(provisional(app)).toEqual(painted);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  /**
   * The mounted control for the pair above: nothing about the normal path
   * moved. One request, the chip clears, and a successful comment with no
   * warnings says nothing at all.
   */
  it("still clears the chip and stays silent while the reader is open", async () => {
    const app = mount();
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    await waitFor(() => {
      expect(provisional(app)).toBeNull();
    });
    expect(app.wire.of("POST", "/api/threads")).toHaveLength(1);
    expect(app.notices).toEqual([]);
  });

  /** A warning reported once, not once per callback site. */
  it("reports a warning exactly once while mounted", async () => {
    const app = mount(
      [],
      [],
      readerTransport({
        threadWarnings: [{ code: "unresolved_ref", detail: "[[missing]] names no document" }],
      }),
    );
    selectQuote(app.layer(), RATE_FROM, RATE_TO);
    act(() => {
      app.layer().submitComment("A note.", false, {});
    });
    await waitFor(() => {
      expect(app.notices).toHaveLength(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(app.notices).toEqual([
      { tone: "error", message: "unresolved_ref — [[missing]] names no document" },
    ]);
    expect(provisional(app)).toBeNull();
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
      app.layer().submitComment("Held.", false, {});
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
    // …and it stops being an anchored thread at all: it is listed below the
    // body, never drawn at a position it no longer has (UI-062).
    expect(app.layer().anchored).toHaveLength(0);
    expect(app.layer().unplaced).toHaveLength(0);
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
  /**
   * **The reported document** (UI-099): a file with one construct the printer
   * respells — a further paragraph of an outer list item, after a nested
   * sublist, whose preceding blank line the serializer drops.
   *
   * The comment is on the **first bullet**, lines above that construct, and its
   * anchor came back from the server live and non-orphaned. It still drew
   * nothing, because the range had to travel through a whole-document
   * projection equality that this one newline failed. The document the reporter
   * hit was 31KB and the divergence was 22,000 characters past the anchor.
   */
  it("draws an anchor in a file whose printer respells one construct elsewhere", async () => {
    const body =
      "- Outer bullet leads in.\n" +
      "  - Nested bullet one.\n" +
      "  - Nested bullet two.\n" +
      "\n" +
      "  A trailing paragraph of the outer item.\n" +
      "- Second outer bullet.\n";
    const quote = "Outer bullet leads in.";
    const start = body.indexOf(quote);
    const app = mount(
      [
        anchorFixture({
          selector: { exact: quote, prefix: "- ", suffix: "\n" },
          range: { start, end: start + quote.length },
        }),
      ],
      [threadRowFixture({ id: "th_1", parent: "doc_m" })],
      readerTransport({}),
      body,
    );

    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors).toHaveLength(1);
    });
    const segments = anchorState(app.editorState())?.anchors[0]?.segments ?? [];
    expect(segments).not.toHaveLength(0);
    // And on the words it is about: the first bullet, not the respelt construct.
    const state = app.editorState();
    const drawn = segments
      .map((segment) => state.doc.textBetween(segment.from, segment.to, "\n", ""))
      .join("");
    expect(drawn).toContain("Outer bullet leads in.");
  });

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

  /**
   * The other direction of the same rule, and the one an edit takes (UI-071).
   *
   * An edit moves the *server's* copy on first: the `PUT` lands, the refetch
   * answers with a new body and with anchors resolved against **it**, and the
   * editor adopts that body only once the editing session settles — a commit or
   * more later. In that window this layer holds offsets for one text and an
   * editor showing another, and the offsets still apply cleanly: they just name
   * different characters. Drawing them is a highlight over words the anchor does
   * not cover, which is the one failure worse than no highlight.
   */
  it("draws nothing from a body the editor has not adopted yet", async () => {
    const app = mount([anchorFixture()], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
        { from: RATE_FROM, to: RATE_TO, block: 1 },
      ]);
    });

    // Eight characters inserted ahead of the quote: every offset after them
    // moves, and none of them stops being a valid position in the old text.
    const moved = BODY.replace("The rate", "A revised rate");
    const start = moved.indexOf("6.1%");
    expect(start).not.toBe(BODY.indexOf("6.1%"));
    app.serveDocument({
      body: moved,
      anchors: [anchorFixture({ range: { start, end: start + 4 } })],
    });
    await new Promise((resolve) => setTimeout(resolve, REAPPLY_DEBOUNCE_MS * 3));

    // Still on `6.1%` in the body that is on screen — not six characters along,
    // where the new offsets would have put it.
    expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
      { from: RATE_FROM, to: RATE_TO, block: 1 },
    ]);

    // And it lands, in the right place, the moment the editor holds that body.
    act(() => {
      app.adoptDocument(moved);
    });
    await waitFor(() => {
      expect(anchorState(app.editorState())?.anchors[0]?.segments).toEqual([
        { from: start + 1, to: start + 5, block: 1 },
      ]);
    });
  });

  /**
   * UI-062. An anchor with nothing to sit beside is reported separately, so the
   * surfaces that place things by position never see it: no chip, no margin
   * card, and above all no card dropped at the top of the document.
   */
  it("keeps an anchor it cannot point at out of the anchored set", async () => {
    const stale = anchorFixture({ range: { start: 900, end: 910 } });
    const app = mount([stale], [threadRowFixture({ id: "th_1", parent: "doc_m" })]);
    await waitFor(() => {
      expect(app.layer().unplaced.map((thread) => thread.id)).toEqual(["th_1"]);
    });
    expect(app.layer().anchored).toHaveLength(0);
    expect(app.layer().orphaned).toHaveLength(0);
    expect(app.layer().marginMode).toBe(false);
    expect(anchorState(app.editorState())?.anchors).toHaveLength(0);
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

describe("an editor destroyed before the layer's effect runs", () => {
  it("registers nothing rather than dereferencing a torn-down view", () => {
    // React 19 can run the registration effect after the editor it captured has
    // been destroyed. ProseMirror's `updateStateInner` then reads `matchesNode`
    // off a null `docView`, which surfaced as an uncaught TypeError.
    const registered: Plugin[] = [];
    const destroyed = {
      get isDestroyed() {
        return true;
      },
      registerPlugin: (plugin: Plugin) => {
        registered.push(plugin);
        throw new TypeError("Cannot read properties of null (reading 'matchesNode')");
      },
      unregisterPlugin: () => undefined,
      on: () => undefined,
      off: () => undefined,
    } as unknown as Editor;

    let current: AnchorLayer | null = null;
    render(
      <Host
        wire={readerTransport({})}
        served={{ body: BODY, anchors: [] }}
        threads={[]}
        onLayer={(layer) => {
          current = layer;
        }}
        onServe={() => undefined}
        onNotify={() => undefined}
      />,
    );

    expect(() => {
      act(() => {
        current?.onEditor(destroyed);
      });
    }).not.toThrow();
    expect(registered).toHaveLength(0);
  });
});
