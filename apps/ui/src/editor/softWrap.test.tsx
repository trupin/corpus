/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { DOMParser as PmDOMParser, Node as PmModelNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";

import { afterEach, describe, expect, it } from "vitest";
import { DocEditor } from "./DocEditor.js";
import { resetEditingRegistry } from "./editingRegistry.js";
import { parseMarkdown } from "./markdown/parse.js";
import { corpusSchema, type PmNode } from "./markdown/schema.js";
import { serializeDoc } from "./markdown/serialize.js";
import { SaveStatusProvider } from "./SaveChip.js";
import { SOFT_WRAP_CLASS, softWrapDecorations } from "./softWrap.js";

/**
 * What a soft line break means in the document editor (UI-072).
 *
 * The two halves of the fix are asserted separately because they answer to
 * different criteria:
 *
 * - **The file is unchanged by opening it**, byte for byte. This is the one the
 *   obvious fix — normalising newlines to spaces at parse time — violates, and
 *   it is asserted against the same hard-wrapped fixture the round-trip corpus
 *   carries, through a *mounted* editor, so the assertion covers the whole open
 *   path and not only the pure functions.
 * - **The newline is drawn as a space.** In the DOM that shows as a collapsing
 *   span around the newline; the *geometry* it produces — one rendered line
 *   where the file has three — is a browser fact and lives in
 *   `e2e/soft-wrap.spec.ts`, because jsdom has no layout.
 */

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "markdown/fixtures/hard-wrapped.md"),
  "utf8",
);

const WRAPPED = "Tomorrow is a\nWednesday, so the\noffice opens an hour later.\n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly writes: () => readonly string[];
}

/** A transport that answers everything and records the bodies of every `PUT`. */
function wire(): Wire {
  const writes: string[] = [];
  return {
    writes: () => [...writes],
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const raw = await request.text();
      if (request.method === "PUT" && url.pathname.startsWith("/api/docs/")) writes.push(raw);
      if (url.pathname === "/api/locks") return json({ locks: [] });
      if (url.pathname === "/api/docs") {
        return json({ items: [], page: { total: 0, limit: 50, offset: 0 } });
      }
      return json({});
    },
  };
}

let live: Editor | null = null;

function Host({
  transport,
  body,
}: {
  readonly transport: Wire;
  readonly body: string;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <SaveStatusProvider>
        <DocEditor
          docId="doc_wrapped"
          body={body}
          locked={false}
          onEditor={(instance) => {
            live = instance;
          }}
        />
      </SaveStatusProvider>
    </harness.Wrapper>
  );
}

function prose(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-doc-editor] .ProseMirror");
  if (element === null) throw new Error("the editor did not mount");
  return element;
}

async function mount(
  body: string,
  transport: Wire = wire(),
): Promise<(next: string) => Promise<void>> {
  const view = render(<Host transport={transport} body={body} />);
  await waitFor(() => {
    expect(prose().firstElementChild).toBeTruthy();
  });
  return async (next: string) => {
    view.rerender(<Host transport={transport} body={next} />);
    await waitFor(() => {
      expect(prose().textContent).toBe(next.trimEnd());
    });
  };
}

afterEach(() => {
  cleanup();
  resetEditingRegistry();
  live = null;
});

describe("opening a hard-wrapped document", () => {
  it("leaves the file byte-identical — nothing is written and nothing would be", async () => {
    const transport = wire();
    await mount(FIXTURE, transport);

    // What the editor *would* save, right now, with no edit made. This is the
    // whole criterion: a document the user merely read must not produce a diff.
    const wouldSave = serializeDoc(live?.getJSON() as unknown as PmNode);
    expect(wouldSave).toBe(FIXTURE);
    expect(transport.writes()).toHaveLength(0);
  });

  it("keeps the author's newline in the document, not a space", async () => {
    await mount(WRAPPED);
    // The model is the file's bytes. Comment anchoring reads text out of it
    // (SPEC.md §6), so a soft wrap that became a space here would make a
    // selection spanning one stop matching the source.
    expect(live?.state.doc.textBetween(1, 1 + WRAPPED.trimEnd().length)).toBe(WRAPPED.trimEnd());
  });
});

describe("how the newline is drawn", () => {
  it("wraps each soft newline in a collapsing span, and nothing else", async () => {
    await mount(WRAPPED);
    const spans = prose().querySelectorAll(`.${SOFT_WRAP_CLASS}`);
    expect(spans).toHaveLength(2);
    for (const span of spans) expect(span.textContent).toBe("\n");
    // The rendered text still is the file's text, newlines and all.
    expect(prose().querySelector("p")?.textContent).toBe(WRAPPED.trimEnd());
  });

  it("leaves a deliberate hard break a real break", async () => {
    await mount("one\\\ntwo\n");
    expect(prose().querySelectorAll("br")).toHaveLength(1);
    expect(prose().querySelectorAll(`.${SOFT_WRAP_CLASS}`)).toHaveLength(0);
  });

  it("leaves a fence's line endings alone", async () => {
    await mount("```txt\nfirst\nsecond\n```\n");
    expect(prose().querySelector("pre code")?.textContent).toBe("first\nsecond");
    expect(prose().querySelectorAll(`pre .${SOFT_WRAP_CLASS}`)).toHaveLength(0);
  });

  /**
   * The decorations are plugin state, rebuilt on `docChanged`. A body arriving
   * from the server replaces the document wholesale (`setContent`), which is
   * the path that would leave a stale set behind if they were only built once.
   */
  it("follows the document when the server's copy moves on", async () => {
    const arrive = await mount(WRAPPED);
    await arrive("One line only, no wrap at all.\n");
    expect(prose().querySelectorAll(`.${SOFT_WRAP_CLASS}`)).toHaveLength(0);
    await arrive("alpha\nbeta\ngamma\ndelta\n");
    expect(prose().querySelectorAll(`.${SOFT_WRAP_CLASS}`)).toHaveLength(3);
  });
});

/**
 * The half a keystroke exercises: ProseMirror re-parses the DOM around a change
 * to read it back, and what that parse does with a newline decides whether the
 * file's wrapping survives being typed near.
 *
 * Asserted through the editor's own `domParser` prop, which is the surface
 * `parseBetween` reaches for. Driving a real contenteditable is the browser's
 * job and `e2e/soft-wrap.spec.ts` does it; what belongs here is the reading
 * itself, next to the default it has to differ from.
 */
describe("reading a typed change back out of the DOM", () => {
  /** A paragraph as ProseMirror renders one under `white-space: pre-wrap`. */
  function wrappedParagraph(): HTMLElement {
    const dom = document.createElement("p");
    dom.append(document.createTextNode("alpha\nbeta"));
    return dom;
  }

  it("keeps a newline a newline", async () => {
    await mount(WRAPPED);
    const parser = live?.view.someProp("domParser");
    expect(parser).toBeInstanceOf(PmDOMParser);
    const parsed = parser?.parse(wrappedParagraph(), { preserveWhitespace: true });
    expect(parsed?.textContent).toBe("alpha\nbeta");
    expect(parsed?.toJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "alpha\nbeta" }] }],
    });
  });

  /**
   * The default this exists to displace, stated so the regression is legible:
   * prosemirror-model turns the newline into a hard break, because TipTap's
   * `hardBreak` declares `linebreakReplacement`. That break serializes to `\`
   * and rewrites a line the user never touched.
   */
  it("is a departure from the default, which invents a hard break", () => {
    const parsed = PmDOMParser.fromSchema(corpusSchema()).parse(wrappedParagraph(), {
      preserveWhitespace: true,
    });
    expect(parsed.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "alpha" },
            { type: "hardBreak" },
            { type: "text", text: "beta" },
          ],
        },
      ],
    });
    expect(serializeDoc(parsed.toJSON() as PmNode)).toBe("alpha\\\nbeta\n");
  });

  it("leaves a real `<br>` a hard break", async () => {
    await mount(WRAPPED);
    const dom = document.createElement("p");
    dom.append(document.createTextNode("alpha"), document.createElement("br"));
    dom.append(document.createTextNode("beta"));
    const parsed = live?.view.someProp("domParser")?.parse(dom, { preserveWhitespace: true });
    expect(serializeDoc(parsed?.toJSON() as PmNode)).toBe("alpha\\\nbeta\n");
  });

  /**
   * The clipboard is deliberately not touched: a paste of a word processor's
   * indented markup still collapses, because `parseSlice` is left alone.
   */
  it("leaves the clipboard's own reading alone", async () => {
    await mount(WRAPPED);
    const dom = document.createElement("div");
    dom.innerHTML = "<p>alpha\n   beta</p>";
    const slice = live?.view.someProp("domParser")?.parseSlice(dom, { preserveWhitespace: false });
    expect(slice?.content.textBetween(0, slice.content.size)).toBe("alpha beta");
  });
});

/**
 * The walk itself, without a view: which positions it claims, and which blocks
 * it refuses to enter.
 */
describe("the decoration walk", () => {
  function decorationsFor(markdown: string): readonly { from: number; to: number }[] {
    const doc = PmModelNode.fromJSON(corpusSchema(), parseMarkdown(markdown));
    return softWrapDecorations(doc)
      .find()
      .map(({ from, to }) => ({ from, to }))
      .sort((a, b) => a.from - b.from);
  }

  it("covers exactly the newline character, one position wide", () => {
    // `<p>` opens at 0, so its first character sits at 1: "abc" is 1..4 and the
    // newline after it is 4..5.
    expect(decorationsFor("abc\ndef\n")).toEqual([{ from: 4, to: 5 }]);
  });

  it("finds every newline in a run, not just the first", () => {
    expect(decorationsFor("a\nb\nc\n")).toHaveLength(2);
  });

  it("reaches inside marks — a wrap can fall inside bold or a code span", () => {
    expect(decorationsFor("**alpha\nbeta**\n")).toHaveLength(1);
    expect(decorationsFor("`alpha\nbeta`\n")).toHaveLength(1);
  });

  it("reaches inside every block that can hold wrapped prose", () => {
    expect(decorationsFor("> alpha\n> beta\n")).toHaveLength(1);
    expect(decorationsFor("- alpha\n  beta\n")).toHaveLength(1);
  });

  it("does not enter a code block", () => {
    expect(decorationsFor("```\nfirst\nsecond\n```\n")).toHaveLength(0);
  });

  it("does not reach a construct kept as raw source", () => {
    // `.md-raw` carries its source in an attribute, not as text, so its own
    // `white-space: pre` is never competed with.
    expect(decorationsFor("<section>\nx\n</section>\n")).toHaveLength(0);
  });

  it("has nothing to do with a hard break, which is a node", () => {
    expect(decorationsFor("one\\\ntwo\n")).toHaveLength(0);
    expect(decorationsFor("one  \ntwo\n")).toHaveLength(0);
  });
});
