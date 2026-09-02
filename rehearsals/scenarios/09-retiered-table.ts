/**
 * Story 9 — *"I renamed a tier and everything followed."* (INFRA-034 table)
 *
 * Regression for: **SHARED-022**, half-tested. `parseWeightLevels` proves the
 * *composer* reads the workspace's tier table. Nothing proves the *dispatcher*
 * reads the same rows the same way, and the two drifting apart is the exact
 * failure that decision was signed to prevent. This story edits the installed
 * skill's table — renames a label and adds a level — and asserts both readings
 * agree in one run.
 *
 * The edit happens in **this fixture's own installed skill only**, through the
 * product (`corpus doc show` / `corpus doc edit`, the server the sole writer).
 * No scenario mutates `assets/workspace/` in the repo.
 *
 * Seed, all through the product:
 * - read the orchestrate skill's body and key;
 * - rename the lightest tier's **Weight** label to `Featherweight` (its key
 *   unchanged — the rename a composer must follow) and add a `Deliberative`
 *   level keyed `deliberative` at **Opus 5**, the heaviest a trivial task
 *   would never be judged into;
 * - write it back, then read the served table again and record it — that read
 *   is the composer's own, through the same projection the picker reads;
 * - post a composer comment stating `weight: "deliberative"`.
 *
 * Asserts (invariant, on what the corpus records):
 * - the composer offers the new labels: the served table carries a
 *   `Featherweight` label and a `deliberative` key (recorded at seed time);
 * - a dispatch goes out at the new row's model: the reply's recorded model is
 *   Opus, which a trivial title question is never judged into — so the stated
 *   `deliberative` was resolved against the same new row the composer sees.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import { readWeightTable, recordedModelMatches, type WeightTableRow } from "../weight-table.js";
import {
  ComposerThreadResponseSchema,
  corpusJson,
  DocShowResultSchema,
  expectProcessed,
  ORCHESTRATE_SKILL_DOC_ID,
  seedNote,
  threadById,
  turnsBy,
  weightTableFromRefs,
  weightTableRefs,
} from "./support.js";

const RENAMED_LABEL = "Featherweight";
const NEW_LABEL = "Deliberative";
const NEW_KEY = "deliberative";
const NEW_MODEL_CELL = "**Opus 5**";

const QUESTION =
  "Could you propose a better one-line title for this note? Please answer here in this thread.";

/** A markdown table row's trimmed cells, or `null` when the line is not one. */
function tableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isDividerRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

const HEADER = ["Weight", "Key", "Model", "What falls here"] as const;

/**
 * Rename the lightest tier and add a heaviest one, touching only the two table
 * lines. Throws if the table is not found — a seed that cannot edit the table
 * grades nothing.
 */
function retierTable(body: string): string {
  const lines = body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = tableCells(line);
    return (
      cells !== null &&
      cells.length === HEADER.length &&
      cells.every((cell, position) => cell === HEADER[position])
    );
  });
  if (headerIndex === -1) throw new Error("no tier table header found in the orchestrate skill");
  const divider = tableCells(lines[headerIndex + 1] ?? "");
  if (divider === null || !isDividerRow(divider)) {
    throw new Error("the tier table header has no divider under it");
  }

  let lastRowIndex = headerIndex + 1;
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const cells = tableCells(lines[index] ?? "");
    if (cells === null || cells.length !== HEADER.length) break;
    const key = cells[1] ?? "";
    if (key === "light") {
      const fourth = cells[3] ?? "";
      lines[index] = `| ${RENAMED_LABEL} | light | **Haiku** | ${fourth} |`;
    }
    lastRowIndex = index;
  }
  if (lastRowIndex === headerIndex + 1) throw new Error("the tier table declares no rows");

  const newRow = `| ${NEW_LABEL} | ${NEW_KEY} | ${NEW_MODEL_CELL} | deep work the request marked deliberative |`;
  lines.splice(lastRowIndex + 1, 0, newRow);
  return lines.join("\n");
}

async function seed(ctx: SeedContext) {
  const skill = await corpusJson(
    ctx,
    ["doc", "show", ORCHESTRATE_SKILL_DOC_ID],
    DocShowResultSchema,
  );
  const edited = retierTable(skill.body);

  // The edited body is handed to `corpus doc edit --file` — the same mechanism
  // the skill uses to pass a value that never touches a shell. The temp dir is
  // this harness's, outside the workspace, and is removed once the edit lands.
  const dir = await mkdtemp(join(tmpdir(), "corpus-retier-"));
  const bodyFile = join(dir, `${randomBytes(6).toString("hex")}.md`);
  await writeFile(bodyFile, edited, "utf8");
  const editResult = await ctx.corpus([
    "doc",
    "edit",
    ORCHESTRATE_SKILL_DOC_ID,
    "--file",
    bodyFile,
    "--key",
    skill.key,
    "--json",
  ]);
  await rm(dir, { recursive: true, force: true });
  if (editResult.code !== 0) {
    throw new Error(
      `seeding the skill edit failed (exit ${String(editResult.code)}): ${editResult.stderr}`,
    );
  }

  // Read the served table back through the projection — the composer's own
  // read — and record it. This is what proves the offer half, not my edit.
  const served = await corpusJson(
    ctx,
    ["doc", "show", ORCHESTRATE_SKILL_DOC_ID],
    DocShowResultSchema,
  );
  const servedRows = readWeightTable(served.body);

  const noteId = await seedNote(ctx, "Reading habit", "Scattered notes on reading more.\n");
  const response = await ctx.composer("/api/threads", {
    parent: noteId,
    title: "A better title?",
    body: QUESTION,
    requestsAgent: true,
    weight: NEW_KEY,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`seeding POST /api/threads answered ${String(response.status)}`);
  }
  const parsed = ComposerThreadResponseSchema.parse(response.json);
  if (parsed.eventId === null) {
    throw new Error("the weighted comment enqueued nothing — requestsAgent was not honoured");
  }
  return {
    refs: {
      threadId: parsed.thread.id,
      commentEventId: parsed.eventId,
      weightTable: weightTableRefs(servedRows),
    },
  };
}

function newRowOf(rows: readonly WeightTableRow[]): WeightTableRow | null {
  return rows.find((row) => row.key === NEW_KEY) ?? null;
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadId = record.seed.refs.threadId ?? "";
  const commentEventId = record.seed.refs.commentEventId ?? "";
  const rows = weightTableFromRefs(record);

  // The offer half: the composer's own read of the served table.
  if (!rows.some((row) => row.label === RENAMED_LABEL)) {
    findings.push(`the served table does not offer the renamed label "${RENAMED_LABEL}"`);
  }
  const newRow = newRowOf(rows);
  if (newRow === null) {
    findings.push(`the served table does not offer the added level "${NEW_KEY}"`);
  }

  // The dispatch half: the stated new level resolved to the new row's model.
  const settled = expectProcessed(record, commentEventId, "the weighted comment's event");
  if (settled !== null) findings.push(settled);

  const thread = threadById(record, threadId);
  if (thread === undefined) {
    findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
  } else {
    const replies = turnsBy(thread, "agent");
    if (replies.length !== 1) {
      findings.push(
        `expected exactly one agent reply on ${threadId}, found ${String(replies.length)}`,
      );
    }
    if (newRow !== null) {
      for (const reply of replies) {
        if (!recordedModelMatches(newRow.model, reply.model)) {
          findings.push(
            `the reply's recorded model "${reply.model ?? "(none)"}" is not the new row's ` +
              `("${newRow.model}", key ${newRow.key}) — the dispatcher did not read the row the composer offers`,
          );
        }
      }
    }
  }
  return { kind: "invariant", findings };
}

export const retieredTable: Scenario = {
  id: "09-retiered-table",
  story: "I renamed a tier and everything followed.",
  regressionFor: "SHARED-022",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
