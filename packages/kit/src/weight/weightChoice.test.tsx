/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { docRowFixture } from "../testing/docRow.js";
import { createCorpusTestHarness } from "../testing/harness.js";
import {
  childThreadWeightScope,
  chooseWeight,
  docWeightScope,
  GLOBAL_COMPOSE_WEIGHT_SCOPE,
  resetWeightChoices,
  threadWeightScope,
  useComposerWeight,
  weightChoice,
} from "./weightChoice.js";

/**
 * The standing choice: unset by default, per conversation, browser-local, and
 * gone on a reload.
 */

afterEach(() => {
  cleanup();
  resetWeightChoices();
});

const DECLARATION = [
  "| Weight | Key | Model | What falls here |",
  "| --- | --- | --- | --- |",
  "| Small and mechanical | light | **Haiku** | Prescribed. |",
  "| Standard | standard | **Sonnet** | Most work. |",
].join("\n");

function harnessFor(body: string) {
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const json = (payload: unknown): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        }),
      );
    if (url.pathname === "/api/docs") {
      const items = [
        docRowFixture({
          id: "doc_orch",
          type: "skill",
          path: ".claude/skills/orchestrate/SKILL.md",
        }),
      ];
      return json({ items, page: { total: 1, limit: 50, offset: 0 } });
    }
    return json({ frontmatter: { id: "doc_orch", type: "skill" }, body, anchors: [] });
  };
  return createCorpusTestHarness({ fetch });
}

async function mount(scope: string, body = DECLARATION) {
  const harness = harnessFor(body);
  const view = renderHook(() => useComposerWeight(scope), { wrapper: harness.Wrapper });
  if (body === DECLARATION) {
    await waitFor(() => {
      expect(view.result.current.levels).toHaveLength(2);
    });
  }
  return view;
}

describe("the scopes", () => {
  it("names a conversation, a document, and the global composer distinctly", () => {
    expect(threadWeightScope("th_a")).not.toBe(threadWeightScope("th_b"));
    expect(threadWeightScope("x")).not.toBe(docWeightScope("x"));
    expect(GLOBAL_COMPOSE_WEIGHT_SCOPE).not.toBe(threadWeightScope("compose:global"));
  });

  /**
   * The comment-on-a-turn box always sends `requestsAgent: false`, so its
   * control provably governs nothing. Sharing the parent thread's scope would
   * let that dead control seed the reply box, which does reach the agent —
   * §11's "never as a setting that acts on you unseen" in the letter only
   * (UI-082's PR #35 review).
   */
  it("keeps the comment-on-a-turn box off the parent thread's starting point", () => {
    expect(childThreadWeightScope("th_a")).not.toBe(threadWeightScope("th_a"));
    // Two boxes on the same parent are one surface on one conversation.
    expect(childThreadWeightScope("th_a")).toBe(childThreadWeightScope("th_a"));
    expect(childThreadWeightScope("th_a")).not.toBe(childThreadWeightScope("th_b"));

    chooseWeight(childThreadWeightScope("th_a"), "heavy");
    expect(weightChoice(threadWeightScope("th_a"))).toBeUndefined();
    expect(weightChoice(childThreadWeightScope("th_a"))).toBe("heavy");
  });
});

describe("a composer nobody has touched", () => {
  it("has nothing chosen and states nothing", async () => {
    const view = await mount(threadWeightScope("th_a"));
    expect(view.result.current.chosen).toBeUndefined();
    // The single spelling of absence: an absent key, never a null or a "".
    expect(view.result.current.request).toEqual({});
    expect("weight" in view.result.current.request).toBe(false);
  });
});

describe("stating a weight", () => {
  it("puts the Key on the request, and only the Key", async () => {
    const view = await mount(threadWeightScope("th_a"));
    act(() => {
      view.result.current.choose("light");
    });
    expect(view.result.current.chosen).toBe("light");
    expect(view.result.current.request).toEqual({ weight: "light" });
  });

  it("is cleared by choosing nothing, back to stating nothing", async () => {
    const view = await mount(threadWeightScope("th_a"));
    act(() => {
      view.result.current.choose("heavy");
    });
    act(() => {
      view.result.current.choose(undefined);
    });
    expect(view.result.current.chosen).toBeUndefined();
    expect(view.result.current.request).toEqual({});
  });

  it("becomes the starting point of the next composer on the same conversation", async () => {
    const first = await mount(threadWeightScope("th_a"));
    act(() => {
      first.result.current.choose("standard");
    });
    // A second surface on the same conversation — the other column showing it.
    const second = await mount(threadWeightScope("th_a"));
    expect(second.result.current.chosen).toBe("standard");
  });

  it("says nothing about a different conversation", async () => {
    const first = await mount(threadWeightScope("th_a"));
    act(() => {
      first.result.current.choose("standard");
    });
    const other = await mount(threadWeightScope("th_b"));
    expect(other.result.current.chosen).toBeUndefined();
  });
});

describe("browser-local", () => {
  it("is written to no storage a reload could survive", async () => {
    const view = await mount(threadWeightScope("th_a"));
    act(() => {
      view.result.current.choose("light");
    });
    // Unlike a fold (`threadCollapse.ts`), which is a reading posture that
    // should outlive a reload, this is about the request you are about to send.
    const dump = (storage: Storage | undefined): string => JSON.stringify(storage ?? {});
    expect(dump(globalThis.localStorage)).not.toContain("light");
    expect(dump(globalThis.sessionStorage)).not.toContain("light");
  });

  it("is gone when the page's module state is (what a reload does)", () => {
    chooseWeight(threadWeightScope("th_a"), "light");
    expect(weightChoice(threadWeightScope("th_a"))).toBe("light");
    resetWeightChoices();
    expect(weightChoice(threadWeightScope("th_a"))).toBeUndefined();
  });
});

describe("a workspace that declares no levels", () => {
  it("offers nothing and states nothing, whatever is standing", async () => {
    // The guidance is edited to declare nothing while a choice is standing: the
    // control disappears, so the request must stop carrying it — otherwise the
    // composer would be sending a weight it no longer shows.
    chooseWeight(threadWeightScope("th_a"), "light");
    const view = await mount(threadWeightScope("th_a"), "no table here");
    expect(view.result.current.levels).toEqual([]);
    expect(view.result.current.chosen).toBeUndefined();
    expect(view.result.current.request).toEqual({});
  });
});
