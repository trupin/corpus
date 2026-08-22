import { MAX_PAGE_LIMIT, type DocList, type DocRow } from "@corpus/contract";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCorpusClient } from "../client/context.js";
import type { DocsFilter } from "../client/createCorpusClient.js";
import { invocableName, SKILL_DOC_TYPE } from "../components/Autocomplete/index.js";
import { skillByNameKey } from "../query/keys.js";
import { useDoc } from "../query/useDoc.js";
import { parseWeightLevels, type WeightLevel } from "./weightLevels.js";

/**
 * The levels this workspace declares, read through the projection (SPEC.md §10;
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
 * **It lives in `@corpus/kit` because every composer must offer the same set,
 * and the control that offers it is a kit component.** A parser in `apps/ui`
 * cannot be reached from `ComposerAddress`, and a second copy in kit is the enum
 * problem again with extra steps — the same reasoning SHARED-009's key contract
 * and UI-070's attachment intake were settled by.
 *
 * ## Locating the declaration must not depend on a page
 *
 * `GET /api/docs` is a **paged, sorted list**: `limit` defaults to 50 and `sort`
 * to `-updated`. A single `?type=skill` request therefore answers with *some*
 * skills, and this hook's question — "which document is the orchestrate skill" —
 * is not a question a page can answer. §7's skill genesis and `POST /api/skills`
 * make a workspace's skill count grow in the ordinary course of use, and
 * `-updated` sinks the orchestrate skill *first*, because it is among the least
 * frequently edited documents a workspace has.
 *
 * That failure would be **invisible**, which is why it is not answered with a
 * bigger `limit`. An empty level list means "this workspace declares nothing"
 * (see `weightLevels.ts` and `address/ComposerAddress.tsx`) — a real §2.4 state an
 * operator diagnoses by opening the skill and reading it. A missed page would
 * produce the same silence while the operator's table sat in plain sight, and
 * nobody would ever debug that. So the lookup is **exhaustive**: it walks
 * `?type=skill` page by page at the contract's {@link MAX_PAGE_LIMIT} until it
 * finds the skill or has seen every row, and the only thing that bounds it is
 * the number of skills the workspace has. Nothing was available that is both
 * unbounded *and* precise in one request — the query grammar has no `path`
 * filter, `folder` addresses `data/docs/` only, and a document id is not
 * knowable from a name — so the scan is what makes the two outcomes distinct.
 *
 * It pages by **`sort=created`** rather than by the default: `created` is the
 * one sort key a document does not rewrite (`title` moves on a rename,
 * `-updated` on every edit), and the server's tiebreak is `d.id ASC`, so the
 * scan walks a total order that does not reshuffle underneath it between pages.
 *
 * In practice a workspace has a handful of skills and this is **one request** —
 * the same one request the old code issued.
 *
 * ## Two queries, neither blocking, neither shared with the autocompletes
 *
 * The scan answers "which document is the orchestrate skill" and
 * {@link useDoc} answers "what does it say".
 *
 * This is deliberately a **second** list query and not the autocomplete's: the
 * skill directory is keyed `{ type: "skill", limit: DIRECTORY_LIMIT }`
 * (`useAutocomplete.ts`) because a menu wants one page of candidates, and this
 * one wants every row until it finds one document. They cache separately and
 * they page differently, on purpose — before the PR #35 review they *looked* shared, which
 * is exactly why nobody noticed the two disagreed about paging. Both sit under
 * the `["docs"]` prefix the server names on every document mutation, so:
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

/** How the scan pages: the contract's own ceiling, so a workspace costs the fewest requests. */
export const SKILL_SCAN_PAGE = MAX_PAGE_LIMIT;

/**
 * Every `type: skill` row, page by page, until the orchestrate skill turns up or
 * the listing is exhausted. `null` — never `undefined`, which a query cache
 * cannot hold — means the workspace genuinely has no orchestrate skill.
 *
 * Termination has two independent guards, because "keep asking until you have
 * seen `page.total` rows" is one delete away from a loop: the scan stops when a
 * page comes back **empty**, and when the rows seen reach the reported total.
 */
export async function scanForOrchestrateSkill(
  listDocs: (filter: DocsFilter) => Promise<DocList>,
): Promise<DocRow | null> {
  let seen = 0;
  for (;;) {
    const page = await listDocs({
      type: SKILL_DOC_TYPE,
      limit: SKILL_SCAN_PAGE,
      offset: seen,
      sort: "created",
    });
    const found = findOrchestrateSkill(page.items);
    if (found !== undefined) return found;
    if (page.items.length === 0) return null;
    seen += page.items.length;
    if (seen >= page.page.total) return null;
  }
}

/** The orchestrate skill's row, or `null` once the whole listing has been walked. */
function useOrchestrateSkill(): DocRow | null | undefined {
  const client = useCorpusClient();
  const query = useQuery({
    queryKey: skillByNameKey(ORCHESTRATE_SKILL_NAME),
    queryFn: ({ signal }) =>
      scanForOrchestrateSkill((filter) => client.listDocs(filter, { signal })),
  });
  return query.data;
}

/** The levels this workspace declares, lightest first; empty means no control. */
export function useWeightLevels(): readonly WeightLevel[] {
  const row = useOrchestrateSkill();
  const doc = useDoc(row?.id);
  const body = doc.data?.body;
  return useMemo(() => parseWeightLevels(body ?? ""), [body]);
}
