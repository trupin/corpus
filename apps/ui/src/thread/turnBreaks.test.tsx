/** @vitest-environment jsdom */
import type { ThreadTurn } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { Turn } from "./Turn";

/**
 * What a newline means inside a turn (UI-054).
 *
 * Named for the behavior rather than for `Turn`, deliberately: `Turn.test.ts`
 * already exists beside it, and TypeScript's wildcard `include` keeps only the
 * highest-priority extension when two files share a basename — a
 * `Turn.test.tsx` next to a `Turn.test.ts` is silently dropped from the program,
 * so it would never be typechecked and ESLint's project service would refuse to
 * parse it at all.
 *
 * The two authors of a thread write with different tools, so the same
 * character means two different things:
 *
 * - a **user** turn is typed into a composer where `↵` inserts a newline and
 *   never submits (SPEC.md §10's key contract, SHARED-009 Amendment 1), so its
 *   newlines are line breaks somebody pressed a key for;
 * - an **agent** turn is authored markdown, hard-wrapped like the prose it is —
 *   measured on a real workspace, 10 of its 11 agent turns wrap their
 *   paragraphs at ~80 columns while none of its 10 user turns contains a
 *   newline at all.
 *
 * Rendering both the same way is wrong for one of them, and this is where the
 * split is asserted rather than described.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const WRAPPED = "the rate assumption\nlooks stale to me";

function Host({ turn }: { readonly turn: ThreadTurn }): ReactElement {
  const [harness] = useState(() =>
    createCorpusTestHarness({ fetch: () => Promise.resolve(new Response("{}")) }),
  );
  return (
    <harness.Wrapper>
      <Turn
        threadId="th_a"
        turn={turn}
        answeredForm={null}
        onOpenRef={() => undefined}
        onDelete={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

function renderTurn(author: "user" | "agent", body: string): HTMLElement {
  return render(<Host turn={{ author, ts: "2026-08-03T10:00:00.000Z", body, model: null }} />)
    .container;
}

describe("a newline in a turn", () => {
  it("is a line break in a user turn — what the person typed is what is drawn", () => {
    const container = renderTurn("user", WRAPPED);
    expect(container.querySelectorAll(".turn-markdown br")).toHaveLength(1);
    expect(container.querySelectorAll(".turn-markdown p")).toHaveLength(1);
  });

  /**
   * No `<br>` is the whole assertion here. The newline itself stays in the DOM
   * either way — CommonMark's "a newline is a space" is `white-space`'s doing
   * at paint time, not the tree's, so the *two lines against one* is what
   * `fences.spec.ts`' browser proves and what a jsdom without layout cannot.
   */
  it("is a space in an agent turn — hard-wrapped prose stays one paragraph", () => {
    const container = renderTurn("agent", WRAPPED);
    expect(container.querySelectorAll(".turn-markdown br")).toHaveLength(0);
    expect(container.querySelectorAll(".turn-markdown p")).toHaveLength(1);
  });

  /**
   * The other half of the same rule: an agent that wants a break writes
   * markdown's own — two trailing spaces, or a backslash — and always could.
   * Nothing about the split takes that away.
   */
  it("still honours a markdown hard break in an agent turn", () => {
    const container = renderTurn("agent", "one  \ntwo");
    expect(container.querySelectorAll(".turn-markdown br")).toHaveLength(1);
  });

  /**
   * The property UI-051's anchoring rests on: the rendered text of a user turn
   * still contains the newline the file contains, so a selection spanning two
   * typed lines maps back onto the same characters (`sourceTrace.ts` builds its
   * projection from the markdown, which knows nothing about `<br>`).
   */
  it.each(["user", "agent"] as const)(
    "leaves the rendered text of a %s turn byte-identical to its body",
    (author) => {
      const container = renderTurn(author, WRAPPED);
      expect(container.querySelector(".turn-markdown p")?.textContent).toBe(WRAPPED);
    },
  );
});
