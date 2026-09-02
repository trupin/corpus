import { fencedCodeRanges, overlapsRange, MAX_PAGE_LIMIT, type DocRow } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";

/**
 * The model names a turn may record: the **Model** column of the tier table in
 * the workspace's own orchestrate skill (SPEC.md §7's Delegation table, rider
 * SHARED-022), and nothing else — the check `thread reply` and `thread create`
 * run before a `--model` is sent (AGENT-061).
 *
 * ## Why a check exists at all, when CLI-033 decided against one
 *
 * `MODEL_FLAG`'s original position was "no validation": the caller states what
 * ran, the server records it verbatim, and a hardcoded list in the CLI would
 * freeze a vocabulary §7 deliberately keeps in an editable skill. Half of that
 * survives — there is still no list *here*, and the contract still enumerates
 * nothing. What did not survive is trusting the caller's self-knowledge.
 * INFRA-034 story 4 (2026-09-02) caught an agent stamping a turn
 * `claude-opus-4-5` — a plausible, real-sounding model name that no runtime in
 * the workspace was running — then posting a **second turn** to correct it,
 * breaking *one question, one answer* to fix a frontmatter field. §10 is
 * explicit that a wrong-but-plausible attribution is the worst outcome: "an
 * unknown that says so is worth more than a plausible attribution nobody can
 * check". An agent's belief about its own model id is exactly such a guess.
 *
 * So the accepted vocabulary is the workspace's **own declaration** — the same
 * tier table the composers' weight picker enumerates (`packages/kit`'s
 * `useWeightLevels`) and the dispatcher launches from. The agent is *handed*
 * one of these words at launch ("You are running as Sonnet"), so stating one is
 * quotation rather than composition; a name outside the column can only have
 * come from belief, and belief is what the incident showed to be unreliable.
 * Editing the table still changes everything together — picker, dispatch, and
 * now the stamp — with no second list anywhere to disagree.
 *
 * ## Why `--weight` gets no such check
 *
 * A weight is a directive, and a dishonourable one is **visible**: the skill
 * requires the agent to reply that a stated weight could not be honoured, so a
 * bad key surfaces in the conversation. The model stamp is a *record*, and a
 * wrong record is invisible by construction — nothing downstream ever
 * contradicts it, which is why it alone needs a gate at the door.
 *
 * ## Why the CLI and not the server
 *
 * The server records the value verbatim and interprets nothing (CONTRACT-043) —
 * making it parse a skill document at write time would make it a party to a
 * vocabulary §7 keeps in the skill, the same line `useWeightLevels` draws for
 * the UI. The CLI is the only door an agent's turns come through
 * (Architecture Decision 2), so the one caller that states models is the one
 * caller this reaches.
 *
 * ## The reader mirrors the composer's, deliberately
 *
 * The parse below is `packages/kit/src/weight/weightLevels.ts` with the Model
 * cell kept instead of dropped (the kit drops it so no component can render a
 * model name; this module exists for nothing else). It cannot import the kit —
 * the dependency direction is `contract ← cli` and `contract ← kit ← ui`, never
 * `kit ← cli` — so, like `scripts/workspace-template.ts`'s `readWeightLevels`,
 * it is a sibling reader of the same declared shape, and its test pins it
 * against the real shipped template so the siblings agree by test rather than
 * by construction. It shares the contract's `fencedCodeRanges` with the kit, so
 * "is this table inside a code fence" has one grammar.
 *
 * The lookup mirrors the composer's too: an exhaustive `type: skill` walk,
 * paged by `sort=created` (the one sort key a document never rewrites), matched
 * by the skill-path grammar rather than by title — `useWeightLevels` documents
 * why a single default-sorted page cannot answer "which document is the
 * orchestrate skill". It runs only when `--model` was actually given, so a turn
 * with no model costs no extra request.
 *
 * ## Fail clean: no declaration means no stamp, and that is reachable
 *
 * A workspace with no orchestrate skill, or one whose table does not parse,
 * declares **no** model names — so every `--model` is refused and turns post
 * with nothing recorded, which is §10's own answer for an unknown. That is the
 * composer's degradation contract as well (no levels, no control), and it is a
 * state the refusal names out loud rather than a fault.
 */

/**
 * The tier table's header cells, in order and spelled exactly — the same
 * interface `WEIGHT_TABLE_HEADER` names in the kit and in the repo tooling.
 * Cells rather than the raw line, because the template tree is prettier-ignored
 * and the padding is hand-maintained; the words are the interface.
 */
export const WEIGHT_TABLE_HEADER = ["Weight", "Key", "Model", "What falls here"] as const;

/**
 * The orchestrate skill's path shape — `invocableName(path) === "orchestrate"`
 * in the kit's grammar: a `SKILL.md` under a directory named `orchestrate`
 * directly beneath `.claude/skills/` or `.claude/skills-archived/`, at any
 * depth below that directory.
 */
const ORCHESTRATE_SKILL_PATH =
  /^\.claude\/skills(?:-archived)?\/orchestrate\/(?:[^/]+\/)*SKILL\.md$/;

/** A markdown table row's trimmed cells, or `null` when the line is not one. */
const tableCells = (line: string): readonly string[] | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
};

/** `---`, `:--`, `--:`, `:-:` — GFM's divider, in any alignment. */
const isDividerRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/**
 * The **Model** cells of the declared tier table, emphasis stripped
 * (`**Haiku**` declares `Haiku`), in document order, blanks dropped.
 *
 * Empty for anything that is not exactly the declared shape — the same
 * fail-clean contract as the kit's `parseWeightLevels`, including a malformed
 * row invalidating the whole table rather than being skipped: a reader that
 * dropped it would accept *some* of a table it has already failed to
 * understand. Fenced lines are skipped, so a worked example in a code block is
 * never read as the declaration.
 */
export function declaredModelCells(markdown: string): readonly string[] {
  const lines = markdown.split("\n");
  const fenced = fencedCodeRanges(markdown);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  for (const [index, line] of lines.entries()) {
    const start = starts[index] ?? 0;
    if (overlapsRange(fenced, start, start + line.length + 1)) continue;
    const header = tableCells(line);
    if (header === null) continue;
    if (header.length !== WEIGHT_TABLE_HEADER.length) continue;
    if (!header.every((cell, position) => cell === WEIGHT_TABLE_HEADER[position])) continue;

    const divider = tableCells(lines[index + 1] ?? "");
    if (divider === null || !isDividerRow(divider)) continue;

    const models: string[] = [];
    for (const row of lines.slice(index + 2)) {
      const cells = tableCells(row);
      if (cells === null) break;
      if (cells.length !== WEIGHT_TABLE_HEADER.length) return [];
      const [weight = "", key = "", model = ""] = cells;
      if (weight === "" || key === "") return [];
      const stripped = model.replaceAll("*", "").trim();
      if (stripped !== "" && !models.includes(stripped)) models.push(stripped);
    }
    return models;
  }
  return [];
}

/**
 * The model names this workspace declares, read through the projection: find
 * the orchestrate skill among the `type: skill` rows, fetch its body, parse the
 * table. An empty list means the workspace declares none — no skill, or no
 * parseable table — which the caller turns into a refusal that says so.
 */
export async function declaredModels(context: WorkspaceCommandContext): Promise<readonly string[]> {
  const skill = await findOrchestrateSkill(context);
  if (skill === undefined) return [];
  const doc = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id: skill.id } } }),
  );
  return declaredModelCells(doc.body);
}

/**
 * Paged to the end by `created` (the sort key a document never rewrites), with
 * the same two termination guards as every other exhaustive walk in this CLI:
 * an empty page ends it, and so does reaching the reported total — a corpus
 * that shrinks mid-walk must not loop.
 */
async function findOrchestrateSkill(context: WorkspaceCommandContext): Promise<DocRow | undefined> {
  for (let offset = 0; ;) {
    const page = await context.client.request((api) =>
      api.GET("/api/docs", {
        params: {
          query: { type: "skill", sort: "created", limit: MAX_PAGE_LIMIT, offset },
        },
      }),
    );
    const found = page.items.find((row) => ORCHESTRATE_SKILL_PATH.test(row.path));
    if (found !== undefined) return found;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.page.total) return undefined;
  }
}

/**
 * Refuse a `--model` outside the declared vocabulary, before anything is sent
 * and before the body is read — a heredoc is not consumed on the way to a
 * refusal, and with nothing posted there is nothing a correction turn could
 * ever be needed for. The value must equal a declared name exactly: the stamp
 * is a quotation of the table, and one spelling is what keeps the record
 * uniform across every turn a reader compares.
 */
export async function requireDeclaredModel(
  context: WorkspaceCommandContext,
  model: string,
): Promise<void> {
  const declared = await declaredModels(context);
  if (declared.includes(model)) return;

  if (declared.length === 0) {
    throw new UsageError(`--model was given, but this workspace declares no model names.`, {
      hint:
        "The names a turn may record are the Model column of the tier table in the orchestrate " +
        "skill's Delegation section (SPEC.md §7), and no parseable table declares any here. Drop " +
        "--model and the turn posts with no model recorded — nothing rather than a guess, which " +
        "is what SPEC.md §10 asks of an unknown. Nothing was sent to the server, so the turn's " +
        "text is not lost: re-run the command without the flag.",
    });
  }

  throw new UsageError(`--model ${JSON.stringify(model)} is not a model this workspace declares.`, {
    hint:
      "A turn records a model in the workspace's own words — the Model column of the tier table " +
      "in the orchestrate skill's Delegation section. This workspace declares: " +
      `${declared.join(", ")}. Name the row that actually ran, spelled exactly as the table ` +
      "spells it, or drop --model entirely: a turn with no model recorded shows nothing, which " +
      "is what an unknown should show (SPEC.md §10). A name outside the table can only have " +
      "come from belief, and a plausible attribution nobody can check is worth less than a " +
      "blank. Nothing was sent to the server, so the turn's text is not lost: re-run the " +
      "command with the flag corrected or removed.",
  });
}
