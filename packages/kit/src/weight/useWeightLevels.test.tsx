/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { docRowFixture } from "../testing/docRow.js";
import { findOrchestrateSkill, useWeightLevels } from "./useWeightLevels.js";

/**
 * Where the levels come from: the workspace's own orchestrate skill, read as an
 * ordinary projected document.
 *
 * Asserted at the transport, because what matters is *which* document is read
 * and through which route — a route of its own would have made the server a
 * party to a vocabulary SPEC.md §7 keeps in the skill, and this suite is what
 * would notice one appearing.
 */

afterEach(cleanup);

const DECLARATION = [
  "## Delegation",
  "",
  "| Weight | Key | Model | What falls here |",
  "| --- | --- | --- | --- |",
  "| Small and mechanical | light | **Haiku** | Prescribed. |",
  "| Standard | standard | **Sonnet** | Most work. |",
].join("\n");

interface WireOptions {
  readonly skills?: readonly { readonly id: string; readonly path: string }[];
  readonly bodies?: Readonly<Record<string, string>>;
}

function wire(options: WireOptions = {}): { fetch: typeof globalThis.fetch; paths: string[] } {
  const paths: string[] = [];
  const skills = options.skills ?? [
    { id: "doc_orch", path: ".claude/skills/orchestrate/SKILL.md" },
  ];

  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(`${url.pathname}${url.search}`);
    const json = (payload: unknown): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        }),
      );

    if (url.pathname === "/api/docs") {
      const items = skills.map((skill) =>
        docRowFixture({ id: skill.id, type: "skill", path: skill.path, title: skill.id }),
      );
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
    }
    const id = url.pathname.slice("/api/docs/".length);
    return json({
      frontmatter: { id, type: "skill" },
      body: options.bodies?.[id] ?? "",
      anchors: [],
      backlinks: [],
    });
  };

  return { fetch, paths };
}

function mount(options: WireOptions = {}) {
  const transport = wire(options);
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  const view = renderHook(() => useWeightLevels(), { wrapper: harness.Wrapper });
  return { ...view, paths: transport.paths };
}

describe("reading the declared levels", () => {
  it("finds the orchestrate skill among the workspace's skills, by its name", () => {
    const rows = [
      docRowFixture({ id: "doc_c", path: ".claude/skills/comment/SKILL.md", type: "skill" }),
      docRowFixture({ id: "doc_o", path: ".claude/skills/orchestrate/SKILL.md", type: "skill" }),
      // A `type: skill` note *about* a skill is not invocable, and is not it.
      docRowFixture({ id: "doc_n", path: "data/docs/inbox/orchestrate.md", type: "skill" }),
    ];
    expect(findOrchestrateSkill(rows)?.id).toBe("doc_o");
    expect(findOrchestrateSkill([])).toBeUndefined();
    expect(findOrchestrateSkill(undefined)).toBeUndefined();
  });

  it("parses that document's body into the offered set", async () => {
    const view = mount({ bodies: { doc_orch: DECLARATION } });
    await waitFor(() => {
      expect(view.result.current).toEqual([
        { label: "Small and mechanical", key: "light" },
        { label: "Standard", key: "standard" },
      ]);
    });
  });

  it("reads it through the document routes — no route of its own", async () => {
    const view = mount({ bodies: { doc_orch: DECLARATION } });
    await waitFor(() => {
      expect(view.result.current).toHaveLength(2);
    });
    expect(view.paths).toContain("/api/docs?type=skill");
    expect(view.paths).toContain("/api/docs/doc_orch");
    expect(view.paths.some((path) => path.includes("weight"))).toBe(false);
  });

  it("answers nothing while the read is in flight — never a half-known set", () => {
    const view = mount({ bodies: { doc_orch: DECLARATION } });
    expect(view.result.current).toEqual([]);
  });

  it("answers nothing when the workspace has no orchestrate skill", async () => {
    const view = mount({ skills: [{ id: "doc_c", path: ".claude/skills/comment/SKILL.md" }] });
    await waitFor(() => {
      expect(view.paths).toContain("/api/docs?type=skill");
    });
    expect(view.result.current).toEqual([]);
  });

  it("answers nothing when that skill declares nothing parseable (SPEC.md §2.4)", async () => {
    const view = mount({ bodies: { doc_orch: "## Delegation\n\nNo table here.\n" } });
    await waitFor(() => {
      expect(view.paths).toContain("/api/docs/doc_orch");
    });
    expect(view.result.current).toEqual([]);
  });
});
