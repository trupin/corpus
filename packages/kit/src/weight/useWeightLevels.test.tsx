/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { docRowFixture } from "../testing/docRow.js";
import { findOrchestrateSkill, SKILL_SCAN_PAGE, useWeightLevels } from "./useWeightLevels.js";

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
      // A real page: the server honours `limit`/`offset` and reports the total
      // over the whole match, which is what the scan's termination reads.
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const items = skills
        .slice(offset, offset + limit)
        .map((skill) =>
          docRowFixture({ id: skill.id, type: "skill", path: skill.path, title: skill.id }),
        );
      return json({ items, page: { total: skills.length, limit, offset } });
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

/** One page of the scan, as the client spells it. */
const page = (offset: number): string =>
  `/api/docs?type=skill&limit=${SKILL_SCAN_PAGE}&offset=${offset}&sort=created`;

const FIRST_PAGE = page(0);

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
    expect(view.paths).toContain(FIRST_PAGE);
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
      expect(view.paths).toContain(FIRST_PAGE);
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

/**
 * The listing is paged and sorted, and the declaration must not depend on which
 * page the skill landed on (UI-082's PR #35 review).
 *
 * The failure this pins used to be silent *and* indistinguishable from the
 * designed one: a workspace past the page size answered "declares nothing" —
 * exactly what a §2.4 workspace answers — while its table sat in the skill in
 * plain sight. So the scan is exhaustive, and these tests are the only place
 * that says so.
 */
describe("a skill list longer than one page", () => {
  const filler = (count: number, from = 0) =>
    Array.from({ length: count }, (_, index) => ({
      id: `doc_f${index + from}`,
      path: `.claude/skills/filler-${index + from}/SKILL.md`,
    }));

  it("finds the declaration when the skill sits beyond the first page", async () => {
    const skills = [
      ...filler(SKILL_SCAN_PAGE),
      { id: "doc_orch", path: ".claude/skills/orchestrate/SKILL.md" },
    ];
    const view = mount({ skills, bodies: { doc_orch: DECLARATION } });
    await waitFor(() => {
      expect(view.result.current).toHaveLength(2);
    });
    // Two pages asked for, and the second one is where the skill was.
    expect(view.paths).toContain(FIRST_PAGE);
    expect(view.paths).toContain(page(SKILL_SCAN_PAGE));
  });

  it("finds it on page three, and asks for no page past it", async () => {
    const skills = [
      ...filler(SKILL_SCAN_PAGE * 2),
      { id: "doc_orch", path: ".claude/skills/orchestrate/SKILL.md" },
      ...filler(SKILL_SCAN_PAGE, SKILL_SCAN_PAGE * 2),
    ];
    const view = mount({ skills, bodies: { doc_orch: DECLARATION } });
    await waitFor(() => {
      expect(view.result.current).toHaveLength(2);
    });
    const pages = view.paths.filter((path) => path.startsWith("/api/docs?"));
    expect(pages).toHaveLength(3);
    expect(pages.at(-1)).toContain(`offset=${SKILL_SCAN_PAGE * 2}`);
  });

  it("stops at the reported total when no page holds it, rather than paging forever", async () => {
    const view = mount({ skills: filler(SKILL_SCAN_PAGE * 2) });
    await waitFor(() => {
      expect(view.paths.filter((path) => path.startsWith("/api/docs?"))).toHaveLength(2);
    });
    expect(view.result.current).toEqual([]);
    // No document read at all: there was no skill to read.
    expect(view.paths.some((path) => path.startsWith("/api/docs/"))).toBe(false);
  });

  it("stops on an empty page even when the total says otherwise", async () => {
    // A row deleted mid-scan can leave `total` ahead of what the pages hold; the
    // scan must terminate on the evidence in front of it, not on the count.
    const paths: string[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(`${url.pathname}${url.search}`);
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const items =
        offset === 0
          ? [docRowFixture({ id: "doc_c", type: "skill", path: ".claude/skills/comment/SKILL.md" })]
          : [];
      return Promise.resolve(
        new Response(
          JSON.stringify({ items, page: { total: 9999, limit: SKILL_SCAN_PAGE, offset } }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );
    };
    const harness = createCorpusTestHarness({ fetch });
    const view = renderHook(() => useWeightLevels(), { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(paths.filter((path) => path.startsWith("/api/docs?"))).toHaveLength(2);
    });
    expect(view.result.current).toEqual([]);
  });
});
