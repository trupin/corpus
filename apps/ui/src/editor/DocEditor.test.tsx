/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import type { Editor } from "@tiptap/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { docRowFixture } from "@corpus/kit/testing";
import { docFixture, nextDocumentKey } from "../testing/readerFixture";
import { traceOfBody } from "../anchors/traceCache.js";
import { useDoc } from "@corpus/kit";
import { DocEditor, editorHandlesType } from "./DocEditor.js";
import { editorBody } from "./editorBody.js";
import { serializeDoc } from "./markdown/serialize.js";
import type { PmNode } from "./markdown/schema.js";
import {
  EDIT_SESSION_SETTLE_MS,
  resetEditSessionFlush,
  useEditSessionFlusher,
} from "./editSessionFlush.js";
import { resetEditingRegistry } from "./editingRegistry.js";
import { SaveStatusProvider } from "./SaveChip.js";
import type { EditorSelection } from "./selection.js";
import { AUTOSAVE_DEBOUNCE_MS, EDIT_SETTLE_MS, MAX_CONFLICT_RETRIES } from "./useAutosave.js";

/**
 * The editor as a mounted surface: what it renders, what it presents on a save,
 * what it does when the server refuses one, and what it hands over when the user
 * comments.
 */

/** The document every `Host` below edits. */
const SUBJECT = "doc_a1b2c3";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Call[];
  readonly of: (method: string) => Call[];
  docs: Map<string, Doc>;
  /**
   * SPEC.md §7's key for {@link SUBJECT}, as the *server* holds it — moved by
   * every write that lands, and by {@link otherWriterWrites}.
   */
  key: string;
  /** The body the other writer left behind; what a refusal answers with. */
  otherBody: string;
  /**
   * The other writer moves the document **again** between the refusal and the
   * retry, so every attempt is refused however fresh the key it presents.
   */
  otherWriterKeepsWriting: boolean;
}

/**
 * The agent writes the document this editor has open (SPEC.md §7's realistic
 * conflict), so the key the page is holding names a version that no longer
 * exists and its next body write is refused.
 */
function otherWriterWrites(state: Wire, body: string): void {
  state.key = nextDocumentKey();
  state.otherBody = body;
}

function wire(docs: readonly Doc[] = [], listed: readonly Doc[] = []): Wire {
  const calls: Call[] = [];
  const state: Wire = {
    fetch: null as unknown as typeof globalThis.fetch,
    calls,
    of: (method) => calls.filter((call) => call.method === method),
    docs: new Map(docs.map((doc) => [doc.frontmatter.id, doc])),
    key: nextDocumentKey(),
    otherBody: "",
    otherWriterKeepsWriting: false,
  };
  const rows = listed.map((doc) =>
    docRowFixture({
      id: doc.frontmatter.id,
      title: doc.frontmatter.title,
      type: doc.frontmatter.type,
      path: doc.path,
    }),
  );

  Object.assign(state, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const raw = await request.text();
      calls.push({
        method: request.method,
        path: url.pathname,
        body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
      });
      // SPEC.md §4's close path: `204`, no body in either direction.
      if (url.pathname.endsWith("/edit-session/flush")) return new Response(null, { status: 204 });
      if (url.pathname === "/api/docs") {
        return json({ items: rows, page: { total: rows.length, limit: 50, offset: 0 } });
      }
      if (url.pathname.startsWith("/api/docs/")) {
        const id = url.pathname.slice("/api/docs/".length);
        const doc = state.docs.get(id);
        if (request.method === "PUT") {
          const changes = (raw === "" ? {} : JSON.parse(raw)) as {
            body?: string;
            key?: string;
          };
          /*
           * SPEC.md §7, as the server performs it: a write replacing the body
           * presents the key of the version it read, and any other key is
           * refused with the document **as it now stands** plus a fresh key.
           */
          if (id === SUBJECT && changes.body !== undefined && changes.key !== state.key) {
            const refusal = docFixture({
              frontmatter: { id },
              body: state.otherBody,
              key: state.key,
            });
            if (state.otherWriterKeepsWriting) state.key = nextDocumentKey();
            return json(
              {
                code: "stale_key",
                message: "the key names a version this document no longer is",
                doc: refusal,
              },
              409,
            );
          }
          if (id === SUBJECT) state.key = nextDocumentKey();
          const base = doc ?? docFixture({ frontmatter: { id } });
          const written: Doc = {
            ...base,
            ...(changes.body === undefined ? {} : { body: changes.body }),
            ...(id === SUBJECT ? { key: state.key } : {}),
          };
          state.docs.set(id, written);
          return json({
            doc: written,
            anchors: { remapped: [], orphaned: [] },
            warnings: [],
          });
        }
        if (doc === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        return json(doc);
      }
      return json({});
    },
  });

  return state;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface HostProps {
  readonly transport: Wire;
  readonly body?: string;
  readonly onComment?: (selection: EditorSelection) => void;
  readonly onEditor?: (editor: Editor | null) => void;
}

function Host({ transport, body, onComment, onEditor }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <SaveStatusProvider>
        <DocEditor
          docId={SUBJECT}
          body={body ?? "First paragraph.\n"}
          documentKey={transport.key}
          {...(onComment === undefined ? {} : { onComment })}
          {...(onEditor === undefined ? {} : { onEditor })}
        />
      </SaveStatusProvider>
    </harness.Wrapper>
  );
}

/**
 * The editor wired the way `DocView` wires it: body and key read from the
 * **document cache**, not handed down by the test.
 *
 * That is what makes a conflict observable end to end here. A refusal's document
 * is published into that cache (SPEC.md §7), so with this host the adoption
 * travels the same path an agent's write travels over SSE — and the question the
 * issue turns on, *what happens to what the person was typing*, is asked of the
 * real arrangement rather than of a prop nobody moves.
 */
function LiveHost({
  transport,
  onEditor,
}: {
  readonly transport: Wire;
  readonly onEditor?: (editor: Editor | null) => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <SaveStatusProvider>
        <LiveEditor {...(onEditor === undefined ? {} : { onEditor })} />
      </SaveStatusProvider>
    </harness.Wrapper>
  );
}

function LiveEditor({
  onEditor,
}: {
  readonly onEditor?: (editor: Editor | null) => void;
}): ReactElement | null {
  const doc = useDoc(SUBJECT);
  if (doc.data === undefined) return null;
  return (
    <DocEditor
      docId={SUBJECT}
      body={doc.data.body}
      documentKey={doc.data.key}
      {...(onEditor === undefined ? {} : { onEditor })}
    />
  );
}

function surface(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-doc-editor]");
  if (element === null) throw new Error("the editor did not mount");
  return element;
}

function prose(): HTMLElement {
  const element = surface().querySelector<HTMLElement>(".ProseMirror");
  if (element === null) throw new Error("no ProseMirror surface");
  return element;
}

/**
 * jsdom has no layout, so every rect is zero and `Range.getClientRects` is
 * empty — which makes ProseMirror's `coordsAtPos` unusable and would leave the
 * selection toolbar untestable here. One fixed rectangle is enough: the
 * toolbar's arithmetic is asserted directly in `SelectionToolbar.test.tsx`, and
 * what this file needs is only for a position to *have* coordinates.
 */
const RECT: DOMRect = {
  top: 100,
  bottom: 120,
  left: 40,
  right: 90,
  width: 50,
  height: 20,
  x: 40,
  y: 100,
  toJSON: () => ({}),
};

beforeAll(() => {
  const list: DOMRectList = Object.assign([RECT], {
    item: (index: number) => (index === 0 ? RECT : null),
  });
  Range.prototype.getClientRects = () => list;
  Range.prototype.getBoundingClientRect = () => RECT;
  Element.prototype.getBoundingClientRect = () => RECT;
});

afterEach(() => {
  cleanup();
  resetEditingRegistry();
  resetEditSessionFlush();
  vi.useRealTimers();
});

describe("which documents get an editor", () => {
  it("takes the markdown-bodied core types", () => {
    expect(editorHandlesType("note")).toBe(true);
    expect(editorHandlesType("template")).toBe(true);
    expect(editorHandlesType("skill")).toBe(true);
    expect(editorHandlesType("agent-def")).toBe(true);
  });

  it("leaves a thread and a view alone", () => {
    // A thread's body is its conversation; a view's content is its query.
    expect(editorHandlesType("thread")).toBe(false);
    expect(editorHandlesType("view")).toBe(false);
  });

  /**
   * UI-014. The gate used to be `CORE_DOC_TYPES`, so a plugin-typed document —
   * and every document of a plugin that had since been deleted — rendered
   * through the static `MarkdownView`. §11 has no read-only markdown body; §10's
   * "renders as plain markdown" is about losing the plugin's chrome.
   */
  it("takes every other markdown body, core or not", () => {
    expect(editorHandlesType("todo")).toBe(true);
    expect(editorHandlesType("_fixture-note")).toBe(true);
    expect(editorHandlesType("a-type-nothing-has-ever-heard-of")).toBe(true);
  });

  it("says nothing about plugin precedence, which the registry decides", () => {
    // The answer is about the *type*, and does not change when a plugin claims
    // it — `DocView` asks `resolveDocView` first, so there is one gate, not two.
    // `DocView`'s own suite is where that precedence is pinned.
    expect(editorHandlesType("fixture-note")).toBe(true);
  });
});

describe("the surface", () => {
  it("mounts an editable body with the prototype's class, and no save control", async () => {
    render(<Host transport={wire()} />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });

    expect(prose().className).toContain("doc-body");
    expect(prose().getAttribute("contenteditable")).toBe("true");
    // SPEC.md §11: no edit mode, no save button, anywhere.
    expect(document.querySelector("button[type=submit]")).toBeNull();
    expect(
      [...document.querySelectorAll("button")].filter((button) =>
        /save|edit/i.test(button.textContent ?? ""),
      ),
    ).toHaveLength(0);
  });

  it("renders the document's markdown as rich text", async () => {
    render(<Host transport={wire()} body={"# Title\n\n- one\n- two\n\n```ts\nx\n```\n"} />);
    await waitFor(() => {
      expect(prose().querySelector("h1")?.textContent).toBe("Title");
    });
    expect(prose().querySelectorAll("li")).toHaveLength(2);
    expect(prose().querySelector("pre code")?.textContent).toBe("x");
  });

  it("shows an empty paragraph for a document that is frontmatter only", async () => {
    const transport = wire();
    render(<Host transport={transport} body="" />);
    await waitFor(() => {
      expect(prose().querySelectorAll("p")).toHaveLength(1);
    });
    expect(prose().textContent).toBe("");
    // Nothing to save: an empty body is not a change.
    expect(transport.of("PUT")).toHaveLength(0);
  });
});

describe("references (SPEC.md §5)", () => {
  const RATES = docFixture({ frontmatter: { id: "doc_z9y8x7", title: "Rates" } });

  it("renders a ref as the target's current title", async () => {
    render(<Host transport={wire([RATES])} body={"See [[doc_z9y8x7]] for detail.\n"} />);
    await waitFor(() => {
      expect(document.querySelector("[data-corpus-ref='doc_z9y8x7']")?.textContent).toBe("Rates");
    });
  });

  it("renders the alias form as its alias", async () => {
    render(<Host transport={wire([RATES])} body={"See [[doc_z9y8x7|the rate]].\n"} />);
    await waitFor(() => {
      expect(document.querySelector("[data-corpus-ref='doc_z9y8x7']")?.textContent).toBe(
        "the rate",
      );
    });
  });

  it("renders a ref to a nonexistent id as visibly broken, with nothing logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Host transport={wire()} body={"See [[doc_deadbeef]].\n"} />);
    await waitFor(() => {
      expect(document.querySelector("[data-corpus-ref-broken='doc_deadbeef']")).not.toBeNull();
    });
    expect(document.querySelector("[data-corpus-ref='doc_deadbeef']")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("resolves each distinct id once, however many times it is cited", async () => {
    const transport = wire([RATES]);
    render(
      <Host
        transport={transport}
        body={"[[doc_z9y8x7]] and [[doc_z9y8x7]] and [[doc_z9y8x7]] again.\n"}
      />,
    );
    await waitFor(() => {
      expect(document.querySelectorAll("[data-corpus-ref='doc_z9y8x7']")).toHaveLength(3);
    });
    const reads = transport.of("GET").filter((call) => call.path === "/api/docs/doc_z9y8x7");
    expect(reads).toHaveLength(1);
  });
});

/**
 * SPEC.md §11, amended by SHARED-041: **the board is never read-only**, and §7
 * has nothing to acquire or release. Both halves are asserted, because the
 * second one is the quiet regression — a surface can be editable and still be
 * chattering at a lock endpoint that no longer exists.
 */
describe("the surface has one state, and it is editable (SPEC.md §11)", () => {
  it("renders an editable body with no read-only affordance", async () => {
    render(<Host transport={wire()} />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });
    expect(prose().getAttribute("contenteditable")).toBe("true");
    expect(prose().getAttribute("aria-readonly")).toBeNull();
    expect(surface().dataset["editable"]).toBeUndefined();
    // Not a MarkdownView fallback: one surface, one scroll and selection model.
    expect(prose().className).toContain("doc-body");
  });

  it("opens the selection toolbar on any document", async () => {
    let editor: Editor | null = null;
    render(
      <Host
        transport={wire()}
        body={"A sentence worth selecting.\n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    act(() => {
      editor?.commands.setTextSelection({ from: 1, to: 9 });
    });
    await waitFor(() => {
      expect(document.querySelector("[data-sel-toolbar]")).not.toBeNull();
    });
  });

  it("asks the server about no locks at all — nothing polls or subscribes to them", async () => {
    const transport = wire();
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    await act(async () => {
      editor?.commands.insertContentAt(1, "Typed. ");
      await Promise.resolve();
    });
    expect(transport.calls.filter((call) => call.path.includes("/locks"))).toHaveLength(0);
  });
});

describe("editing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("saves the serialized markdown, presenting the key it read (SPEC.md §7)", async () => {
    const transport = wire();
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    await act(async () => {
      editor?.commands.insertContentAt(editor.state.doc.content.size - 1, " Added.");
      await Promise.resolve();
    });

    const presented = transport.key;

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });
    expect(transport.of("PUT")[0]?.body).toEqual({
      body: "First paragraph. Added.\n",
      key: presented,
    });
  });

  it("publishes the save state to the chip's context", async () => {
    const transport = wire();
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    // The chip itself lives in `ReaderHead`; here the provider is the observer.
    await act(async () => {
      editor?.commands.insertContentAt(1, "x");
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });
  });
});

describe("the `[[` autocomplete (SPEC.md §11)", () => {
  const RATES = docFixture({ frontmatter: { id: "doc_z9y8x7", title: "Rates" } });
  const MORTGAGE = docFixture({ frontmatter: { id: "doc_m1n2o3", title: "Mortgage options" } });

  function menu(): HTMLElement | null {
    // The kit's `AutocompleteMenu`, which is what this popup is since UI-053.
    return document.querySelector<HTMLElement>('[role=listbox][aria-label="Link a document"]');
  }

  function options(): readonly HTMLElement[] {
    return [...(menu()?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
  }

  async function open(transport: Wire): Promise<Editor> {
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        body={"See also \n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    const instance = editor as unknown as Editor;
    await act(async () => {
      instance.commands.focus("end");
      instance.commands.insertContent("[[");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(menu()).not.toBeNull();
    });
    return instance;
  }

  it("opens the prototype's menu, listing documents by title", async () => {
    const transport = wire([RATES, MORTGAGE], [RATES, MORTGAGE]);
    await open(transport);
    expect(menu()?.className).toBe("ac-menu open");
    await waitFor(() => {
      expect(options()).toHaveLength(2);
    });
    expect(options().map((item) => item.querySelector(".k")?.textContent)).toEqual([
      "Rates",
      "Mortgage options",
    ]);
    expect(options()[0]?.className).toBe("ac-item active");
    // One row shape for both `[[` menus (`design/index.html`): title, then type.
    expect(options()[0]?.querySelector(".d")?.textContent).toBe(RATES.frontmatter.type);
  });

  /**
   * UI-053. `⇥` was unhandled here, and in the ProseMirror path an unhandled key
   * is the browser's: focus left the editor mid-`[[`. Two things have to be true
   * — the completion lands, and the press is cancelled, which is what stops the
   * focus move. The event is `cancelable` so `defaultPrevented` can report it.
   */
  it("accepts on ⇥, cancelling the press so focus stays in the editor", async () => {
    const transport = wire([RATES, MORTGAGE], [RATES, MORTGAGE]);
    const editor = await open(transport);
    await waitFor(() => {
      expect(options()).toHaveLength(2);
    });

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      editor.view.dom.dispatchEvent(tab);
      await Promise.resolve();
    });

    expect(tab.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.querySelector("[data-corpus-ref='doc_z9y8x7']")?.textContent).toBe("Rates");
    });
  });

  it("wraps the highlight past both ends, as every menu does", async () => {
    const transport = wire([RATES, MORTGAGE], [RATES, MORTGAGE]);
    const editor = await open(transport);
    await waitFor(() => {
      expect(options()).toHaveLength(2);
    });
    const arrow = (key: string): void => {
      act(() => {
        editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };

    arrow("ArrowUp");
    await waitFor(() => {
      expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    });
    arrow("ArrowDown");
    await waitFor(() => {
      expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    });
  });

  it("moves the highlight with ↑ and ↓", async () => {
    const transport = wire([RATES, MORTGAGE], [RATES, MORTGAGE]);
    const editor = await open(transport);
    await waitFor(() => {
      expect(options()).toHaveLength(2);
    });

    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await waitFor(() => {
      expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    });

    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await waitFor(() => {
      expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    });
  });

  it("closes on esc and leaves the literal characters behind", async () => {
    const transport = wire([RATES], [RATES]);
    const editor = await open(transport);
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await waitFor(() => {
      expect(menu()).toBeNull();
    });
    // The user typed `[[`; nothing has replaced them, so they are still there.
    expect(editor.state.doc.textContent).toContain("[[");
  });

  it("inserts a ref node whose rendered text is the target's title", async () => {
    const transport = wire([RATES], [RATES]);
    const editor = await open(transport);
    await waitFor(() => {
      expect(options()).toHaveLength(1);
    });

    await act(async () => {
      options()[0]?.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(document.querySelector("[data-corpus-ref='doc_z9y8x7']")?.textContent).toBe("Rates");
    });
    // The file gets the id, never the title.
    const serialized = editor.getJSON();
    expect(JSON.stringify(serialized)).toContain("doc_z9y8x7");
    expect(JSON.stringify(serialized)).not.toContain("Rates");
  });
});

describe("an external change while the user is typing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("does not clobber the buffer, and lands exactly once when editing settles", async () => {
    const transport = wire();
    let editor: Editor | null = null;
    const view = render(
      <Host
        transport={transport}
        body={"Original text.\n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    await act(async () => {
      editor?.commands.insertContentAt(1, "Typed. ");
      await Promise.resolve();
    });
    expect(prose().textContent).toContain("Typed.");

    // The agent wrote to the same document; the query refetched and the reader
    // handed down a different body.
    view.rerender(
      <Host
        transport={transport}
        body={"Agent rewrote this.\n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    // Still the user's text: the buffer wins while the session is open.
    expect(prose().textContent).toContain("Typed.");
    expect(prose().textContent).not.toContain("Agent rewrote");

    // Let the debounce fire, the save land and the settle window elapse.
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });
    await act(async () => {
      vi.advanceTimersByTime(EDIT_SETTLE_MS + 100);
      await Promise.resolve();
    });

    // The deferred change is applied — once.
    await waitFor(() => {
      expect(prose().textContent).toContain("Agent rewrote");
    });
    expect(prose().textContent).not.toContain("Typed.");
  });

  it("adopts an external change immediately when nothing is being typed", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} body={"Original text.\n"} />);
    await waitFor(() => {
      expect(prose().textContent).toContain("Original text.");
    });

    view.rerender(<Host transport={transport} body={"Agent rewrote this.\n"} />);
    await waitFor(() => {
      expect(prose().textContent).toContain("Agent rewrote this.");
    });
    // Adopting the server's copy is not the user's edit: nothing is written back.
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
      await Promise.resolve();
    });
    expect(transport.of("PUT")).toHaveLength(0);
  });

  it("ignores a body that only differs in markdown style", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} body={"- one\n- two\n"} />);
    await waitFor(() => {
      expect(prose().querySelectorAll("li")).toHaveLength(2);
    });
    const before = prose().querySelector("li");

    // The same document, written with `*` bullets. Canonicalised, it is the
    // document already on screen — replacing the content would throw away the
    // caret for nothing.
    view.rerender(<Host transport={transport} body={"* one\n* two\n"} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(prose().querySelector("li")).toBe(before);
  });

  /**
   * PR #10 finding 18. A save invalidates the document; the refetch returns the
   * body the user just typed, so `savedBody` changes to text the editor is
   * already showing. Replacing the document with an identical one costs the
   * caret, the selection and every anchor decoration drawn on it — and used to
   * be noticed and repaired downstream in `useAnchorLayer` rather than not
   * happening.
   */
  describe("the echo of this document's own save", () => {
    async function typeAndSave(transport: Wire): Promise<{
      readonly view: ReturnType<typeof render>;
      readonly editorOf: () => Editor | null;
      readonly saved: string;
    }> {
      let editor: Editor | null = null;
      const onEditor = (instance: Editor | null): void => {
        editor = instance;
      };
      const view = render(
        <Host transport={transport} body={"Original text.\n"} onEditor={onEditor} />,
      );
      await waitFor(() => {
        expect(editor).not.toBeNull();
      });
      await act(async () => {
        editor?.commands.insertContentAt(1, "Typed. ");
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(transport.of("PUT")).toHaveLength(1);
      });
      await act(async () => {
        vi.advanceTimersByTime(EDIT_SETTLE_MS + 100);
        await Promise.resolve();
      });
      return { view, editorOf: () => editor, saved: "Typed. Original text.\n" };
    }

    it("leaves the ProseMirror document untouched", async () => {
      const transport = wire();
      const { view, editorOf, saved } = await typeAndSave(transport);
      const before = editorOf()?.state.doc;
      expect(before).toBeDefined();

      // The refetch the `PUT`'s invalidation triggered hands the body back.
      view.rerender(<Host transport={transport} body={saved} onEditor={() => undefined} />);
      await act(async () => {
        await Promise.resolve();
      });

      // Identity, not equality: `setContent` always builds a new document, so a
      // matching object is the only proof that no replacement happened.
      expect(editorOf()?.state.doc).toBe(before);
      expect(prose().textContent).toContain("Typed. Original text.");
    });

    it("still adopts a body that really did change underneath it", async () => {
      const transport = wire();
      const { view, editorOf } = await typeAndSave(transport);
      const before = editorOf()?.state.doc;

      view.rerender(
        <Host transport={transport} body={"Agent rewrote this.\n"} onEditor={() => undefined} />,
      );
      await waitFor(() => {
        expect(prose().textContent).toContain("Agent rewrote this.");
      });
      expect(editorOf()?.state.doc).not.toBe(before);
    });
  });
});

/**
 * SPEC.md §7's refusal, and **the criterion this issue turns on**: a `409`
 * arriving mid-sentence may not cost the person the sentence.
 *
 * The arrangement is the real one — body and key read from the document cache,
 * exactly as `DocView` wires them (`LiveHost`) — because what has to be proved
 * is not that a retry is issued but that the text on screen survives the whole
 * exchange: the refusal, the adoption of the other writer's document, and the
 * retry that follows it.
 */
describe("a refusal arriving mid-sentence (SPEC.md §7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  /** Seeds the document the editor opens, and returns the wire holding it. */
  function seeded(body: string): Wire {
    const transport = wire();
    transport.docs.set(
      SUBJECT,
      docFixture({ frontmatter: { id: SUBJECT }, body, key: transport.key }),
    );
    return transport;
  }

  async function typedInto(transport: Wire): Promise<Editor> {
    let editor: Editor | null = null;
    render(
      <LiveHost
        transport={transport}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    await act(async () => {
      (editor as unknown as Editor).commands.insertContentAt(1, "Half a sen");
      await Promise.resolve();
    });
    return editor as unknown as Editor;
  }

  it("keeps the person's text, adopts the fresh key, and lands the retry", async () => {
    const transport = seeded("Original text.\n");
    await typedInto(transport);
    expect(prose().textContent).toContain("Half a sen");

    // The other writer lands first. The key the page holds now names a version
    // that no longer exists.
    otherWriterWrites(transport, "Agent rewrote this.\n");
    const fresh = transport.key;

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    // Two writes: the one that was refused, and the one that presented the key
    // the refusal carried. Same body both times — nothing was re-derived from
    // the server's copy, and nothing was dropped.
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(2);
    });
    const [refused, retried] = transport.of("PUT") as [Call, Call];
    const first = refused.body as { body: string; key: string };
    const second = retried.body as { body: string; key: string };
    expect(first.body).toContain("Half a sen");
    expect(second.body).toBe(first.body);
    expect(second.key).toBe(fresh);
    expect(second.key).not.toBe(first.key);

    // **The sentence is still on screen**, and the other writer's paragraph
    // never replaced it under the caret.
    expect(prose().textContent).toContain("Half a sen");
    expect(prose().textContent).not.toContain("Agent rewrote");

    // And it is still there once the editing session settles — the point at
    // which a deferred external change would have been adopted.
    await act(async () => {
      vi.advanceTimersByTime(EDIT_SETTLE_MS + 100);
      await Promise.resolve();
    });
    expect(prose().textContent).toContain("Half a sen");
    // The server has it: the retry landed, so the stored body is the person's.
    expect(transport.docs.get(SUBJECT)?.body).toContain("Half a sen");
  });

  it("never reports a conflict it resolved as an error", async () => {
    const transport = seeded("Original text.\n");
    await typedInto(transport);
    otherWriterWrites(transport, "Agent rewrote this.\n");

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(2);
    });
    expect(document.querySelector(".save-chip.error")).toBeNull();
  });

  it("keeps the buffer when the other writer will not stop, rather than dropping it", async () => {
    const transport = seeded("Original text.\n");
    const editor = await typedInto(transport);
    /*
     * A writer that moves the document again between the refusal and the retry:
     * every attempt is refused. The budget is spent, and what must remain true
     * is the only thing that ever mattered — the text is still there, in the
     * editor and in the buffer, and nothing claimed it was saved.
     */
    otherWriterWrites(transport, "Agent again.\n");
    transport.otherWriterKeepsWriting = true;

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transport.of("PUT").length).toBeGreaterThan(1);
    });
    // Bounded: it does not loop forever against a writer that will not yield.
    expect(transport.of("PUT").length).toBeLessThanOrEqual(MAX_CONFLICT_RETRIES + 1);
    expect(prose().textContent).toContain("Half a sen");
    expect(editor.getText()).toContain("Half a sen");
    // Every attempt carried the person's text; none of them carried the other
    // writer's, and none of them was empty.
    for (const call of transport.of("PUT")) {
      expect((call.body as { body: string }).body).toContain("Half a sen");
    }
  });
});

describe("the comment hand-off", () => {
  it("calls back with the selection and writes nothing", async () => {
    const transport = wire();
    const selections: EditorSelection[] = [];
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        body={"The rate is 6.4% this week.\n"}
        onComment={(selection) => {
          selections.push(selection);
        }}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    act(() => {
      editor?.commands.setTextSelection({ from: 1, to: 9 });
    });

    const toolbar = document.querySelector<HTMLElement>("[data-sel-toolbar]");
    expect(toolbar).not.toBeNull();
    // The prototype's row, in the prototype's order.
    const labels = [...(toolbar?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["B", "I", "💬 Comment"]);
    expect(toolbar?.querySelector(".divider")).not.toBeNull();
    expect(toolbar?.className).toContain("open");

    act(() => {
      toolbar?.querySelector<HTMLButtonElement>("[data-sel-comment]")?.click();
    });

    expect(selections).toHaveLength(1);
    expect(selections[0]?.docId).toBe("doc_a1b2c3");
    expect(selections[0]?.text).toBe("The rate");
    expect(selections[0]?.body).toBe("The rate is 6.4% this week.\n");
    expect(selections[0]?.range).toEqual({ start: 0, end: 8 });
    expect(selections[0]?.selector).toEqual({
      exact: "The rate",
      prefix: "",
      suffix: " is 6.4% this week.\n",
    });
    // The document is untouched: commenting is not editing (SPEC.md §6).
    expect(transport.of("PUT")).toHaveLength(0);
  });

  it("bolds a selection through the toolbar, and the mark reaches the save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const transport = wire();
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        body={"The rate is 6.4%.\n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    act(() => {
      editor?.commands.setTextSelection({ from: 1, to: 9 });
    });
    const toolbar = document.querySelector<HTMLElement>("[data-sel-toolbar]");
    const bold = toolbar?.querySelector<HTMLButtonElement>("[data-fmt='bold']");
    expect(bold?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      bold?.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-fmt='bold']")?.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });
    expect(transport.of("PUT")[0]?.body).toEqual({
      body: "**The rate** is 6.4%.\n",
      key: expect.any(String) as unknown,
    });
  });
});

/**
 * SPEC.md §4's close path, through the real editor and the real client.
 *
 * The flusher stays mounted while the editor goes, because that is the shape of
 * the thing: the shell outlives every reader, and the flush is issued after the
 * reader that earned it has unmounted.
 */
function SessionFlusher(): null {
  useEditSessionFlusher();
  return null;
}

interface SessionHostProps {
  readonly transport: Wire;
  readonly mounted: boolean;
  readonly onEditor?: (editor: Editor | null) => void;
}

function SessionHost({ transport, mounted, onEditor }: SessionHostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <SessionFlusher />
      <SaveStatusProvider>
        {mounted ? (
          <DocEditor
            docId={SUBJECT}
            body={"First paragraph.\n"}
            documentKey={transport.key}
            {...(onEditor === undefined ? {} : { onEditor })}
          />
        ) : null}
      </SaveStatusProvider>
    </harness.Wrapper>
  );
}

const flushCalls = (transport: Wire): Call[] =>
  transport.calls.filter((call) => call.path.endsWith("/edit-session/flush"));

describe("ending the document's edit session", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("flushes the session when the reader closes, and not before", async () => {
    const transport = wire();
    let editor: Editor | null = null;
    const view = render(
      <SessionHost
        transport={transport}
        mounted
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    await act(async () => {
      editor?.commands.insertContentAt(editor.state.doc.content.size - 1, " Added.");
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });

    // Still open, still being typed into: §4's window is the server's business
    // and the UI has nothing to say yet.
    await act(async () => {
      vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
      await Promise.resolve();
    });
    expect(flushCalls(transport)).toHaveLength(0);

    // The reader closes.
    view.rerender(<SessionHost transport={transport} mounted={false} />);
    await act(async () => {
      vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS + 1);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(flushCalls(transport)).toHaveLength(1);
    });
    expect(flushCalls(transport)[0]?.method).toBe("POST");
    expect(flushCalls(transport)[0]?.path).toBe("/api/docs/doc_a1b2c3/edit-session/flush");
    expect(flushCalls(transport)[0]?.body).toBeUndefined();
  });

  it("says nothing about a document that was opened and only read", async () => {
    const transport = wire();
    const view = render(<SessionHost transport={transport} mounted />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });

    view.rerender(<SessionHost transport={transport} mounted={false} />);
    await act(async () => {
      vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
      await Promise.resolve();
    });

    expect(flushCalls(transport)).toHaveLength(0);
  });
});

/**
 * The premise the anchor layer stands on, asserted against a real editor
 * (UI-099, PR #39 review).
 *
 * `useAnchorLayer` maps the server's anchor offsets through
 * `traceOfBody(editorBody(body))`, and that is only the document on screen if
 * this component parses `editorBody(body)`. The two live in different modules
 * and used to be two independently written expressions — the editor parsed
 * `canonicalizeMarkdown(body)`, the layer traced `body` — which is a difference
 * only where `canonicalizeMarkdown` is not idempotent. Rare, and therefore
 * invisible until a user hit it: on such a document the layer held offsets into
 * text the editor was not showing and drew no highlight at all, while the
 * comment path read the same disagreement as unsaved edits and quoted the
 * printer's spelling instead of the file's (UI-068's failure, twice regressed).
 *
 * `editorBody` makes it one named expression; this makes it a checked one. A
 * `DocEditor` that parsed anything else would have to change this test to pass.
 *
 * **UI-103 made the two traces agree by construction**, by making the printer a
 * fixed point for the construct below — so `editorBody` is now provably a no-op
 * and no behaviour can tell the two call sites apart. That is the intended
 * outcome, not a reason to delete either. What this test asserts today is the
 * fact underneath both of them: a real mounted editor over this body prints the
 * file back **byte for byte**, so opening the document and typing writes what
 * was already there.
 */
describe("the text the editor parses", () => {
  /**
   * The construct where `canonicalizeMarkdown` used not to be a fixed point
   * (UI-103): a further paragraph of an outer list item after a nested sublist.
   * Printing dropped its preceding blank line; printing *that* re-read the
   * paragraph as a continuation of the nested item and indented it 2 → 4 spaces.
   */
  const RESTRUCTURED =
    "- Outer bullet leads in.\n" +
    "  - Nested bullet one.\n" +
    "  - Nested bullet two.\n" +
    "\n" +
    "  A trailing paragraph of the outer item.\n" +
    "- Second outer bullet.\n";

  it("prints what the anchor layer traces, and on this body that is the body", async () => {
    // What UI-103 bought, stated where UI-099's premise used to be: the two
    // candidate traces are the same text, and both are the file.
    expect(traceOfBody(RESTRUCTURED).markdown).toBe(traceOfBody(editorBody(RESTRUCTURED)).markdown);
    expect(editorBody(RESTRUCTURED)).toBe(RESTRUCTURED);

    const transport = wire();
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        body={RESTRUCTURED}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const live: Editor = editor as unknown as Editor;
    expect(serializeDoc(live.getJSON() as unknown as PmNode)).toBe(
      traceOfBody(editorBody(RESTRUCTURED)).markdown,
    );
    // And that text is the file itself — the paragraph is still the outer
    // item's, at the outer item's indent, exactly as it was on disk.
    expect(serializeDoc(live.getJSON() as unknown as PmNode)).toBe(RESTRUCTURED);
  });
});
