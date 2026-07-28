/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docRowFixture } from "../../testing/docRow.js";
import { createCorpusTestHarness } from "../../testing/harness.js";
import { AutocompleteMenu } from "./AutocompleteMenu.js";
import { invocableName, rowToken, useAutocomplete } from "./useAutocomplete.js";

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

describe("invocableName", () => {
  it("derives the name the server indexes, from the path", () => {
    expect(invocableName(".claude/skills/comment/SKILL.md")).toBe("comment");
    expect(invocableName(".claude/skills-archived/old/SKILL.md")).toBe("old");
    expect(invocableName(".claude/agents/researcher.md")).toBe("researcher");
    expect(invocableName("data/docs/notes/about-skills.md")).toBeNull();
  });

  it("falls back to the title for a document outside those roots", () => {
    expect(rowToken(docRowFixture({ path: "data/docs/x.md", title: "Researcher" }))).toBe(
      "Researcher",
    );
  });
});

describe("useAutocomplete", () => {
  /** SPEC.md §11: "there is no separate registry" — one endpoint, a type filter. */
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
