import type { Doc, DocRow } from "@corpus/contract";
import { DOC, row } from "../commands/doc/fixtures.js";
import { sendJson, type StubResponder } from "./stub-server.js";

/**
 * A workspace that declares the shipped three model tiers, for the tests of the
 * `--model` vocabulary check (AGENT-061, `commands/thread/declared-models.ts`).
 * The turn-writing verbs look the vocabulary up before they send a stated
 * model, so any test that states one needs a stub that can answer the two
 * reads; this is that stub's shared half.
 */

/** The declared names, as the shipped template declares them. */
export const DECLARED_MODELS = ["Haiku", "Sonnet", "Opus 5"] as const;

/** A tier table in the declared shape, with the shipped Model cells. */
export const TIER_TABLE = [
  "| Weight                  | Key      | Model      | What falls here |",
  "| ----------------------- | -------- | ---------- | --------------- |",
  "| Small and mechanical    | light    | **Haiku**  | prescribed      |",
  "| Standard                | standard | **Sonnet** | most work       |",
  "| Heavy or judgment-laden | heavy    | **Opus 5** | judgment        |",
].join("\n");

export const ORCHESTRATE_ROW: DocRow = row({
  id: "doc_orch01",
  type: "skill",
  title: "orchestrate",
  path: ".claude/skills/orchestrate/SKILL.md",
});

export const ORCHESTRATE_DOC: Doc = {
  ...DOC,
  frontmatter: { ...DOC.frontmatter, id: "doc_orch01", type: "skill", title: "orchestrate" },
  body: `## Delegation\n\n${TIER_TABLE}\n`,
  path: ".claude/skills/orchestrate/SKILL.md",
};

/**
 * Answers the vocabulary lookup — the `type: skill` listing and the skill
 * body — and hands everything else to `next`. The listing reports one page,
 * which is what the shipped workspace looks like.
 */
export const withDeclaredModels =
  (next: StubResponder): StubResponder =>
  (request, response) => {
    if (request.method === "GET" && request.path === "/api/docs") {
      sendJson(response, 200, {
        items: [ORCHESTRATE_ROW],
        page: { total: 1, limit: 200, offset: 0 },
      });
      return;
    }
    if (request.method === "GET" && request.path === `/api/docs/${ORCHESTRATE_ROW.id}`) {
      sendJson(response, 200, ORCHESTRATE_DOC);
      return;
    }
    next(request, response);
  };
