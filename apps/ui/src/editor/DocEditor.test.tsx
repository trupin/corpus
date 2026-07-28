/** @vitest-environment jsdom */
import type { Doc, Lock } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import type { Editor } from "@tiptap/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { docRowFixture } from "@corpus/kit/testing";
import { docFixture } from "../testing/readerFixture";
import { DocEditor, editorHandlesType } from "./DocEditor.js";
import { resetEditingRegistry } from "./editingRegistry.js";
import { SaveStatusProvider } from "./SaveChip.js";
import type { EditorSelection } from "./selection.js";
import { AUTOSAVE_DEBOUNCE_MS, EDIT_SETTLE_MS } from "./useAutosave.js";

/**
 * The editor as a mounted surface: what it renders, what it refuses to render
 * when the document is locked, and what it hands over when the user comments.
 */

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
  locks: Lock[];
}

function wire(docs: readonly Doc[] = [], listed: readonly Doc[] = []): Wire {
  const calls: Call[] = [];
  const state: Wire = {
    fetch: null as unknown as typeof globalThis.fetch,
    calls,
    of: (method) => calls.filter((call) => call.method === method),
    docs: new Map(docs.map((doc) => [doc.frontmatter.id, doc])),
    locks: [],
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
      if (url.pathname === "/api/locks") return json({ locks: state.locks });
      if (url.pathname.startsWith("/api/locks/")) {
        const docId = url.pathname.split("/")[3] ?? "";
        if (request.method === "POST") {
          return json(
            { docId, holder: "user", acquired: "2026-07-28T09:00:00.000Z", ttl: 300 },
            201,
          );
        }
        return json({ docId, released: true, holder: "user" });
      }
      if (url.pathname === "/api/docs") {
        return json({ items: rows, page: { total: rows.length, limit: 50, offset: 0 } });
      }
      if (url.pathname.startsWith("/api/docs/")) {
        const id = url.pathname.slice("/api/docs/".length);
        const doc = state.docs.get(id);
        if (request.method === "PUT") {
          return json({
            doc: doc ?? docFixture(),
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
  readonly locked?: boolean;
  readonly onComment?: (selection: EditorSelection) => void;
  readonly onEditor?: (editor: Editor | null) => void;
}

function Host({ transport, body, locked, onComment, onEditor }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <SaveStatusProvider>
        <DocEditor
          docId="doc_a1b2c3"
          body={body ?? "First paragraph.\n"}
          locked={locked ?? false}
          {...(onComment === undefined ? {} : { onComment })}
          {...(onEditor === undefined ? {} : { onEditor })}
        />
      </SaveStatusProvider>
    </harness.Wrapper>
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
  vi.useRealTimers();
});

describe("which documents get an editor", () => {
  it("takes the markdown-bodied core types", () => {
    expect(editorHandlesType("note")).toBe(true);
    expect(editorHandlesType("template")).toBe(true);
    expect(editorHandlesType("skill")).toBe(true);
    expect(editorHandlesType("agent-def")).toBe(true);
  });

  it("leaves a thread, a view and a plugin type alone", () => {
    // A thread's body is its conversation; a view's content is its query; a
    // plugin type gets the plugin's own `View` (SPEC.md §10).
    expect(editorHandlesType("thread")).toBe(false);
    expect(editorHandlesType("view")).toBe(false);
    expect(editorHandlesType("todo")).toBe(false);
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
    expect(surface().dataset["editable"]).toBe("true");
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

describe("under a foreign lock (SPEC.md §7)", () => {
  it("renders the same surface, read-only", async () => {
    render(<Host transport={wire()} locked />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });
    expect(prose().getAttribute("contenteditable")).toBe("false");
    expect(surface().dataset["editable"]).toBe("false");
    expect(prose().getAttribute("aria-readonly")).toBe("true");
    // Not a MarkdownView fallback: one surface, one scroll and selection model.
    expect(prose().className).toContain("doc-body");
  });

  it("opens no selection toolbar", async () => {
    let editor: Editor | null = null;
    render(
      <Host
        transport={wire()}
        locked
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
    expect(document.querySelector("[data-sel-toolbar]")).toBeNull();
  });

  it("becomes editable again without remounting the surface", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} locked />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });
    const before = prose();

    view.rerender(<Host transport={transport} locked={false} />);
    await waitFor(() => {
      expect(prose().getAttribute("contenteditable")).toBe("true");
    });
    // The identical DOM node: a remount would have replaced it, and with it the
    // scroll position and every decoration on the document.
    expect(prose()).toBe(before);
  });

  it("takes no lock of its own while another party holds one", async () => {
    const transport = wire();
    render(<Host transport={transport} locked />);
    await waitFor(() => {
      expect(prose()).toBeTruthy();
    });
    expect(transport.calls.filter((call) => call.path.startsWith("/api/locks/"))).toHaveLength(0);
  });
});

describe("editing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("saves the serialized markdown and takes the user's edit lock", async () => {
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

    // SPEC.md §7: the first keystroke takes the lock, so the agent's queue has
    // something to defer on.
    await waitFor(() => {
      expect(
        transport.calls.filter(
          (call) => call.method === "POST" && call.path === "/api/locks/doc_a1b2c3",
        ),
      ).toHaveLength(1);
    });

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.of("PUT")).toHaveLength(1);
    });
    expect(transport.of("PUT")[0]?.body).toEqual({ body: "First paragraph. Added.\n" });
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
    return document.querySelector<HTMLElement>("[data-ref-autocomplete]");
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
    expect(options()[0]?.className).toBe("ac-item on");
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

  it("never opens while another party holds the lock", async () => {
    const transport = wire([RATES], [RATES]);
    let editor: Editor | null = null;
    render(
      <Host
        transport={transport}
        locked
        body={"See also \n"}
        onEditor={(instance) => {
          editor = instance;
        }}
      />,
    );
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });
    await act(async () => {
      (editor as unknown as Editor).commands.insertContent("[[");
      await Promise.resolve();
    });
    expect(menu()).toBeNull();
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
    expect(transport.of("PUT")[0]?.body).toEqual({ body: "**The rate** is 6.4%.\n" });
  });
});
