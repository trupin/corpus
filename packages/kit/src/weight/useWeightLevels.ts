import type { DocRow } from "@corpus/contract";
import { useMemo } from "react";
import { invocableName, SKILL_DOC_TYPE } from "../components/Autocomplete/index.js";
import { useDoc } from "../query/useDoc.js";
import { useDocs } from "../query/useDocs.js";
import { parseWeightLevels, type WeightLevel } from "./weightLevels.js";

/**
 * The levels this workspace declares, read through the projection (SPEC.md §11;
 * SHARED-022 Decision 1; UI-082's orchestrator adjudication, 2026-08-08).
 *
 * **No route, no server parse, no second copy.** The orchestrate skill is
 * already a projected `skill` document — `.claude/skills` is watched
 * (`apps/server/src/watcher/paths.ts`) and `skill` is a core document type — so
 * the declaration is reachable through the same `GET /api/docs` the composers'
 * three autocompletes read. A server route publishing "the levels this workspace
 * defines" would make the server a party to a vocabulary §7 keeps in the skill,
 * and would cost a contract issue for something the existing projection already
 * answers.
 *
 * **It lives in `@corpus/kit` because five first-party composers and every
 * plugin composer must offer the same set.** A parser in `apps/ui` cannot be
 * reached from a plugin, and a second copy in kit is the enum problem again with
 * extra steps — the same reasoning SHARED-009's key contract and UI-070's
 * attachment intake were settled by.
 *
 * ## Two queries, both shared, neither blocking
 *
 * The list answers "which document is the orchestrate skill" and the read
 * answers "what does it say". Both are ordinary TanStack queries under the keys
 * every other surface uses, so:
 *
 *   - mounting this hook in five composers issues **one** pair of requests;
 *   - warming it once at app level (the board's shell does) means a composer
 *     that opens later reads from cache and renders its control in its first
 *     paint — which is what keeps `CommentPopover` off a blocking fetch and
 *     stops a control popping into an open popover (UI-073/UI-074's lesson about
 *     a surface that moves things under the pointer);
 *   - an edit to the skill invalidates `["docs", …]` like any other document, so
 *     renaming a level reworders every composer with no rebuild and no reload.
 *
 * While either query is in flight the answer is the **empty list**, which is the
 * same answer a workspace declaring nothing gets: no control at all. A composer
 * never shows a half-known set.
 */

/**
 * The skill that declares the levels, by the name it is invocable under.
 *
 * SPEC.md §7 names the Orchestrator skill as the thing that dispatches, and
 * AGENT-015 puts the declaration in its `## Delegation` section. Matching on the
 * skill's *name* rather than sweeping every skill for a table is deliberate:
 * "nothing outside this table declares a level", and a scan would let an
 * unrelated document containing four familiar column headings start supplying a
 * composer's options.
 */
export const ORCHESTRATE_SKILL_NAME = "orchestrate";

/**
 * The orchestrate skill among a `type: skill` listing, or `undefined`.
 *
 * Uses the kit's own {@link invocableName} — the one place that knows a skill's
 * path grammar, and the same derivation the server's mention scanner uses — so a
 * skill moved between `.claude/skills` and `.claude/skills-archived` is still
 * recognised, and a `type: skill` note filed under `data/docs/` is not.
 */
export function findOrchestrateSkill(rows: readonly DocRow[] | undefined): DocRow | undefined {
  return rows?.find((row) => invocableName(row.path) === ORCHESTRATE_SKILL_NAME);
}

/** The levels this workspace declares, lightest first; empty means no control. */
export function useWeightLevels(): readonly WeightLevel[] {
  const skills = useDocs({ type: SKILL_DOC_TYPE });
  const row = findOrchestrateSkill(skills.data?.items);
  const doc = useDoc(row?.id);
  const body = doc.data?.body;
  return useMemo(() => parseWeightLevels(body ?? ""), [body]);
}
