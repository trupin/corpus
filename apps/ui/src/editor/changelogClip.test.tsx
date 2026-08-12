/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { Node as PmModelNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHANGELOG_CLIPPED_ATTR,
  CHANGELOG_MORE_ATTR,
  CHANGELOG_VISIBLE_ENTRIES,
  changelogSection,
  clipLabel,
  expandClipAround,
} from "./changelogClip.js";
import { DocEditor } from "./DocEditor.js";
import { resetEditingRegistry } from "./editingRegistry.js";
import { parseMarkdown } from "./markdown/parse.js";
import { corpusSchema, type PmNode } from "./markdown/schema.js";
import { serializeDoc } from "./markdown/serialize.js";
import { SaveStatusProvider } from "./SaveChip.js";

/**
 * The changelog's clip (UI-089, SPEC.md §5 and §11's rider signed 2026-08-07).
 *
 * Three properties, and they answer to different criteria:
 *
 * - **Which entries are clipped** is arithmetic over the document and is
 *   asserted against `changelogSection` directly, where the edge cases (no
 *   section, a section that is quoted rather than written, a section followed by
 *   another heading) are cheap to state.
 * - **What the reader sees** is asserted through a *mounted* editor, because the
 *   clip is a decoration and a decoration only exists on a live view.
 * - **What the file says** is asserted on the same mount: §11's clip is a
 *   reading convenience, so a document opened, clipped and expanded must be
 *   byte-identical to the one on disk and must produce no write. That is the
 *   property the obvious implementation — dropping the older entries — breaks.
 *
 * The geometry (a clipped entry occupying no height) is a browser fact and lives
 * in `e2e/changelog.spec.ts`, together with §11's anchor clause, which needs a
 * real anchor highlight in a real layout to mean anything.
 */

const HEAD = ["# Mortgage options", "", "The working rate assumption is 6.4%.", ""].join("\n");

/** `count` entries, oldest first — the order the workspace skill appends in. */
function changelog(count: number): string {
  const entries = Array.from(
    { length: count },
    (_, index) =>
      `- **2026-07-${String(index + 1).padStart(2, "0")}** — entry ${String(index + 1)}`,
  );
  return [HEAD, "## Changelog", "", ...entries, ""].join("\n");
}

/** The parsed document, as ProseMirror's own node — what the plugin reads. */
function pmDoc(markdown: string): PmModelNode {
  return PmModelNode.fromJSON(corpusSchema(), parseMarkdown(markdown));
}

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
          docId="doc_changelog"
          body={body}
          documentKey={"0".repeat(64)}
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

function clipped(): readonly HTMLElement[] {
  return [...prose().querySelectorAll<HTMLElement>(`[${CHANGELOG_CLIPPED_ATTR}]`)];
}

function moreButton(): HTMLButtonElement | null {
  return prose().querySelector<HTMLButtonElement>(`button[${CHANGELOG_MORE_ATTR}]`);
}

async function mount(body: string, transport: Wire = wire()): Promise<void> {
  render(<Host transport={transport} body={body} />);
  await waitFor(() => {
    expect(prose().firstElementChild).toBeTruthy();
  });
}

afterEach(() => {
  cleanup();
  resetEditingRegistry();
  live = null;
});

describe("finding the section and its entries", () => {
  it("answers about a document with no changelog at all", () => {
    expect(changelogSection(pmDoc("# Note\n\nJust prose.\n"))).toBeNull();
  });

  it("counts a list's items individually, not the list as one block", () => {
    const section = changelogSection(pmDoc(changelog(12)));
    expect(section?.entries).toHaveLength(12);
  });

  it("keeps the newest entries and clips the rest, oldest first", () => {
    const section = changelogSection(pmDoc(changelog(12)));
    expect(section?.clipped).toHaveLength(12 - CHANGELOG_VISIBLE_ENTRIES);
    // The clipped set is a prefix of the entries: the *oldest* go behind the
    // control, because the skill appends and the newest is last.
    expect(section?.clipped).toEqual(section?.entries.slice(0, 12 - CHANGELOG_VISIBLE_ENTRIES));
  });

  it("clips nothing at or below the threshold", () => {
    for (const count of [0, 1, CHANGELOG_VISIBLE_ENTRIES]) {
      expect(changelogSection(pmDoc(changelog(count)))?.clipped).toHaveLength(0);
    }
  });

  it("counts a paragraph entry the person wrote as an entry", () => {
    // §5: the section is the person's to edit as well, so an entry written as
    // prose rather than as a list item is still one.
    const body = [changelog(4), "", "A note I added by hand.", "", "And another one.", ""].join(
      "\n",
    );
    const section = changelogSection(pmDoc(body));
    expect(section?.entries).toHaveLength(6);
    expect(section?.clipped).toHaveLength(1);
  });

  it("stops at the next heading of the same level", () => {
    const body = [changelog(9), "", "## Notes", "", "- not a changelog entry", ""].join("\n");
    expect(changelogSection(pmDoc(body))?.entries).toHaveLength(9);
  });

  it("takes the last section, so a document that merely mentions one is safe", () => {
    // A skill document explaining the format quotes the heading. §5 puts the
    // real section at the end of the body, so reading backwards is the answer.
    const body = [
      "## Changelog",
      "",
      "- how the heading is spelled, quoted in a note about it",
      "",
      "## Elsewhere",
      "",
      "Prose that belongs to another section.",
      "",
      "## Changelog",
      "",
      ...Array.from({ length: 8 }, (_, index) => `- entry ${String(index + 1)}`),
      "",
    ].join("\n");
    const section = changelogSection(pmDoc(body));
    expect(section?.entries).toHaveLength(8);
    expect(section?.clipped).toHaveLength(8 - CHANGELOG_VISIBLE_ENTRIES);
  });
});

describe("what the reader sees", () => {
  it("clips the older entries and offers a control that names both numbers", async () => {
    await mount(changelog(12));
    expect(clipped()).toHaveLength(7);
    const button = moreButton();
    // The whole size, the way every fold in this app reports itself, *and* how
    // many are hidden, which is what §11 asks of this control by name.
    expect(button?.textContent).toBe(clipLabel(12, 7));
    expect(button?.textContent).toContain("12");
    expect(button?.textContent).toContain("7");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("aria-label")).toContain("7 older entries are hidden");
  });

  it("leaves the newest entries visible without expanding anything", async () => {
    await mount(changelog(12));
    const items = [...prose().querySelectorAll("li")];
    const visible = items.filter((item) => !item.hasAttribute(CHANGELOG_CLIPPED_ATTR));
    expect(visible.map((item) => item.textContent?.trim())).toEqual([
      "2026-07-08 — entry 8",
      "2026-07-09 — entry 9",
      "2026-07-10 — entry 10",
      "2026-07-11 — entry 11",
      "2026-07-12 — entry 12",
    ]);
  });

  it("keeps every clipped entry in the rendered document — cut, never removed", async () => {
    await mount(changelog(12));
    // The property the whole design rests on: a clipped entry is still text on
    // the page, which is what keeps it selectable, commentable and anchorable.
    expect(prose().querySelectorAll("li")).toHaveLength(12);
    expect(prose().textContent).toContain("entry 1");
    expect(clipped()[0]?.textContent).toContain("entry 1");
  });

  it("shows nothing at all below the threshold", async () => {
    await mount(changelog(CHANGELOG_VISIBLE_ENTRIES));
    expect(clipped()).toHaveLength(0);
    expect(moreButton()).toBeNull();
  });

  it("expands in place, and clips again", async () => {
    await mount(changelog(12));
    moreButton()?.click();
    await waitFor(() => {
      expect(clipped()).toHaveLength(0);
    });
    const expandedButton = moreButton();
    expect(expandedButton?.textContent).toBe("Show less");
    expect(expandedButton?.getAttribute("aria-expanded")).toBe("true");
    // In place: the section is where it was, in the same body, and nothing
    // navigated. The heading still precedes the control.
    expect(prose().querySelectorAll("li")).toHaveLength(12);

    expandedButton?.click();
    await waitFor(() => {
      expect(clipped()).toHaveLength(7);
    });
  });

  it("is a button, so the keyboard reaches it like every other affordance", async () => {
    await mount(changelog(12));
    const button = moreButton();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("contenteditable")).toBe("false");
    button?.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe("what the file says", () => {
  it("writes nothing, and would write the document it opened", async () => {
    const body = changelog(12);
    const transport = wire();
    await mount(body, transport);
    expect(transport.writes()).toHaveLength(0);
    expect(serializeDoc(live?.getJSON() as unknown as PmNode)).toBe(body);
  });

  it("still writes the whole section after the clip has been expanded", async () => {
    const body = changelog(12);
    const transport = wire();
    await mount(body, transport);
    moreButton()?.click();
    await waitFor(() => {
      expect(clipped()).toHaveLength(0);
    });
    expect(transport.writes()).toHaveLength(0);
    expect(serializeDoc(live?.getJSON() as unknown as PmNode)).toBe(body);
  });
});

describe("reaching into the clip", () => {
  it("opens when a selection reaches a clipped entry", async () => {
    await mount(changelog(12));
    if (live === null) throw new Error("the editor did not mount");
    const first = changelogSection(live.state.doc)?.clipped[0];
    if (first === undefined) throw new Error("nothing was clipped");
    // Someone selects text that runs into the hidden entries — ⌘A, a drag from
    // above, or an arrow key walking up out of the visible ones. Typing into a
    // box nobody can see is the failure this prevents.
    live.commands.setTextSelection({ from: first.from + 1, to: first.to - 1 });
    await waitFor(() => {
      expect(clipped()).toHaveLength(0);
    });
  });

  it("opens when something inside it asks to be seen", async () => {
    await mount(changelog(12));
    const inside = clipped()[0];
    expect(inside).toBeDefined();
    // §11's anchor clause, at the seam `useAnchorLayer` uses: whatever is about
    // to scroll a node into view says so, and the clip opens rather than
    // scrolling to a box of no height.
    expect(expandClipAround(inside ?? null)).toBe(true);
    await waitFor(() => {
      expect(clipped()).toHaveLength(0);
    });
  });

  it("says so when there is no clip around the node", async () => {
    await mount(changelog(12));
    expect(expandClipAround(prose().querySelector("h1"))).toBe(false);
    expect(expandClipAround(null)).toBe(false);
  });
});
