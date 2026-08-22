/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docRowFixture } from "../../testing/docRow.js";
import { createCorpusTestHarness } from "../../testing/harness.js";
import { AutocompleteMenu } from "./AutocompleteMenu.js";
import { useAutocomplete } from "./useAutocomplete.js";

afterEach(cleanup);

interface Recorded {
  readonly search: string;
}

function transport(rows: Readonly<Record<string, readonly DocRow[]>>) {
  const calls: Recorded[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(new Request(input, init).url);
    calls.push({ search: url.search });
    const items = rows[url.search] ?? [];
    return Promise.resolve(
      new Response(JSON.stringify({ items, page: { total: items.length, limit: 50, offset: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch, calls };
}

function Host({
  wire,
  initial,
  onComplete,
}: {
  readonly wire: ReturnType<typeof transport>;
  readonly initial: string;
  readonly onComplete?: (result: { text: string; caret: number }) => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  return (
    <harness.Wrapper>
      <Composer initial={initial} {...(onComplete ? { onComplete } : {})} />
    </harness.Wrapper>
  );
}

function Composer({
  initial,
  onComplete,
}: {
  readonly initial: string;
  readonly onComplete?: (result: { text: string; caret: number }) => void;
}): ReactElement {
  const [text, setText] = useState(initial);
  const auto = useAutocomplete({
    value: text,
    caret: text.length,
    onComplete: (result) => {
      setText(result.text);
      onComplete?.(result);
    },
  });
  return (
    <>
      <input
        aria-label="composer"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          auto.handleKeyDown(event);
        }}
      />
      <span data-active>{String(auto.activeIndex)}</span>
      <AutocompleteMenu
        open={auto.isOpen}
        items={auto.items}
        activeIndex={auto.activeIndex}
        onHover={auto.setActiveIndex}
        onChoose={auto.choose}
      />
    </>
  );
}

describe("useAutocomplete", () => {
  /** SPEC.md §10: "there is no separate registry" — one endpoint, a type filter. */
  it("resolves each trigger through GET /api/docs with a type filter", async () => {
    const wire = transport({
      "?limit=50&type=agent-def": [
        docRowFixture({ id: "doc_r", title: "Researcher", path: ".claude/agents/researcher.md" }),
      ],
    });
    render(<Host wire={wire} initial="@re" />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /researcher/i })).toBeDefined();
    });
    expect(wire.calls.some((call) => call.search.includes("type=agent-def"))).toBe(true);
    expect(wire.calls.every((call) => !call.search.includes("registry"))).toBe(true);
  });

  /**
   * UI-123. SERVER-125 stopped indexing an off-root `type: agent-def` as a
   * mention target under **any** spelling, its title included, so offering it
   * here would insert a name the server resolves to nothing — §8 answers such a
   * mention by being inert, and this menu would be the only place in the product
   * claiming that persona exists.
   *
   * The row is still in the response, because it is still a document:
   * `GET /api/docs?type=agent-def` returns every agent-def and the board lists
   * it. It is dropped where it becomes an *offer*, and nowhere earlier.
   */
  it("does not offer an agent-def the server would resolve to nothing", async () => {
    const wire = transport({
      "?limit=50&type=agent-def": [
        docRowFixture({ id: "doc_r", title: "Researcher", path: ".claude/agents/researcher.md" }),
        docRowFixture({ id: "doc_l", title: "Legacy", path: "data/docs/inbox/legacy.md" }),
      ],
    });
    const { container } = render(<Host wire={wire} initial="@" />);
    // Two: the generic `@agent`, and the one persona that resolves.
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(2);
    });
    expect(screen.getByRole("option", { name: /researcher/i })).toBeDefined();
    expect(screen.queryByRole("option", { name: /legacy/i })).toBeNull();
  });

  /** The same gate for `/`, because SERVER-125 gated both types alike. */
  it("does not offer a document *about* a skill as an invocable one", async () => {
    const wire = transport({
      "?limit=50&type=skill": [
        docRowFixture({ id: "doc_c", title: "Comment", path: ".claude/skills/comment/SKILL.md" }),
        docRowFixture({
          id: "doc_a",
          title: "Autopilot",
          path: "data/docs/notes/about-skills.md",
        }),
      ],
    });
    const { container } = render(<Host wire={wire} initial="/" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(1);
    });
    expect(container.querySelector(".ac-item .k")?.textContent).toBe("comment");
    expect(screen.queryByRole("option", { name: /autopilot/i })).toBeNull();
  });

  /**
   * The `[[` menu is not the mention menu and must not inherit its gate: a link
   * addresses a document by **id**, which every document has, so the very row
   * the two menus above drop is a perfectly good link target.
   */
  it("still offers an unaddressable document as a [[ link", async () => {
    const wire = transport({
      "?limit=12&q=legacy": [
        docRowFixture({ id: "doc_l", title: "Legacy", path: "data/docs/inbox/legacy.md" }),
      ],
    });
    render(<Host wire={wire} initial="see [[legacy" />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Legacy/ })).toBeDefined();
    });
  });

  it("offers the generic @agent, which no document backs", async () => {
    const wire = transport({});
    render(<Host wire={wire} initial="@" />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /agent/ })).toBeDefined();
    });
  });

  it("lists skills for /", async () => {
    const wire = transport({
      "?limit=50&type=skill": [
        docRowFixture({ id: "doc_c", title: "Comment", path: ".claude/skills/comment/SKILL.md" }),
      ],
    });
    render(<Host wire={wire} initial="/com" />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /comment/ })).toBeDefined();
    });
    expect(wire.calls.some((call) => call.search.includes("type=skill"))).toBe(true);
  });

  it("lists documents by title for [[ and inserts the id", async () => {
    const onComplete = vi.fn();
    const wire = transport({
      "?limit=12&q=rate": [docRowFixture({ id: "doc_r1", title: "Rates" })],
    });
    render(<Host wire={wire} initial="see [[rate" onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Rates/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("option", { name: /Rates/ }));
    expect(onComplete).toHaveBeenCalledWith({ text: "see [[doc_r1]] ", caret: 15 });
  });

  /**
   * UI-053, and the reason it exists: `⇥` used to be unhandled here, so it did
   * what `⇥` does in a form and took the focus out of the composer mid-trigger.
   * `preventDefault` is what stops that, and `fireEvent` reports it.
   */
  it("accepts on ⇥ without letting focus leave the field", async () => {
    const onComplete = vi.fn();
    const wire = transport({
      "?limit=50&type=agent-def": [
        docRowFixture({ id: "doc_r", title: "Researcher", path: ".claude/agents/researcher.md" }),
      ],
    });
    const { container } = render(<Host wire={wire} initial="@" onComplete={onComplete} />);
    const input = screen.getByLabelText("composer");
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(2);
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    // `fireEvent` returns false when the default was prevented — which is the
    // browser's focus move, cancelled.
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(onComplete).toHaveBeenCalledWith({ text: "@researcher ", caret: 12 });
  });

  it("moves the highlight past both ends of the list", async () => {
    const wire = transport({
      "?limit=50&type=agent-def": [
        docRowFixture({ id: "doc_r", title: "Researcher", path: ".claude/agents/researcher.md" }),
      ],
    });
    const { container } = render(<Host wire={wire} initial="@" />);
    const input = screen.getByLabelText("composer");
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(2);
    });
    const active = () => container.querySelector("[data-active]")?.textContent;

    // Up from the first row wraps to the last, down from the last back to the first.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(active()).toBe("1");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("0");
  });

  /**
   * The `[[` row a composer draws is the row the document editor draws
   * (`design/index.html`: title in `.k`, type in `.d`) — the two menus are one
   * implementation from `useRefCompletions` down.
   */
  it("draws a [[ row as the document's title and type", async () => {
    const wire = transport({
      "?limit=12&q=rate": [docRowFixture({ id: "doc_r1", title: "Rates", type: "note" })],
    });
    const { container } = render(<Host wire={wire} initial="see [[rate" />);
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(1);
    });
    expect(container.querySelector(".ac-item .k")?.textContent).toBe("Rates");
    expect(container.querySelector(".ac-item .d")?.textContent).toBe("note");
  });

  it("moves with ↑↓, selects with ↵ and closes with esc leaving the literal trigger", async () => {
    const onComplete = vi.fn();
    const wire = transport({
      "?limit=50&type=agent-def": [
        docRowFixture({ id: "doc_r", title: "Researcher", path: ".claude/agents/researcher.md" }),
      ],
    });
    const { container } = render(<Host wire={wire} initial="@" onComplete={onComplete} />);
    const input = screen.getByLabelText("composer");
    await waitFor(() => {
      expect(container.querySelectorAll(".ac-item")).toHaveLength(2);
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(container.querySelector("[data-active]")?.textContent).toBe("1");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(container.querySelector("[data-active]")?.textContent).toBe("0");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onComplete).toHaveBeenCalledWith({ text: "@agent ", caret: 7 });

    cleanup();
    const second = render(<Host wire={wire} initial="@" />);
    await waitFor(() => {
      expect(second.container.querySelector(".ac-menu")).not.toBeNull();
    });
    fireEvent.keyDown(screen.getByLabelText("composer"), { key: "Escape" });
    await waitFor(() => {
      expect(second.container.querySelector(".ac-menu")).toBeNull();
    });
    expect(screen.getByLabelText<HTMLInputElement>("composer").value).toBe("@");
  });
});
