/**
 * Shared seeding and scoring helpers for the INFRA-034 scenarios.
 *
 * Everything here stays on the scenarios' side of the harness line: seeding
 * talks to the product (the CLI, or the composer's own request where the CLI
 * deliberately has no spelling), and scoring is pure over the {@link RunRecord}
 * — never the transcript, never anything the harness instrumented in.
 */

import { z } from "zod";
import {
  modelFamilyOf,
  readWeightTable,
  recordedModelMatches,
  type WeightTableRow,
} from "../weight-table.js";
import type { ObservedEvent, ObservedThread } from "../observe.js";
import type { CorpusResult, RunRecord, SeedContext } from "../scenario.js";

/** The orchestrate skill's stable document id — the template's frontmatter. */
export const ORCHESTRATE_SKILL_DOC_ID = "doc_skillorchestrate";

/** `corpus <args> --json`, parsed and validated, throwing on any failure. */
export async function corpusJson<Schema extends z.ZodType>(
  ctx: SeedContext,
  args: readonly string[],
  schema: Schema,
): Promise<z.infer<Schema>> {
  const result: CorpusResult = await ctx.corpus([...args, "--json"]);
  if (result.code !== 0) {
    throw new Error(
      `seeding \`corpus ${args.join(" ")}\` failed (exit ${String(result.code)}): ${result.stderr}`,
    );
  }
  return schema.parse(JSON.parse(result.stdout));
}

export const DocCreateResultSchema = z.object({
  doc: z.object({ frontmatter: z.object({ id: z.string() }) }),
});

export const ThreadCreateResultSchema = z.object({
  thread: z.object({ id: z.string() }),
  eventId: z.string().nullable(),
});

export const DocShowResultSchema = z.object({
  body: z.string(),
  key: z.string(),
});

/** The composer's `POST /api/threads` answer — the ids the scorers will need. */
export const ComposerThreadResponseSchema = z.object({
  thread: z.object({ id: z.string() }),
  eventId: z.string().nullable(),
});

/** The composer's `POST /api/threads/{id}/turns` answer — the follow-up's event. */
export const ComposerTurnResponseSchema = z.object({
  eventId: z.string().nullable(),
});

/**
 * Create a note through the CLI and hand back its id — the parent most stories
 * hang their conversation on.
 */
export async function seedNote(ctx: SeedContext, title: string, body: string): Promise<string> {
  const doc = await corpusJson(
    ctx,
    ["doc", "create", "--type", "note", "--title", title, "-m", body],
    DocCreateResultSchema,
  );
  return doc.doc.frontmatter.id;
}

/**
 * The tier table as the product itself serves it: the orchestrate skill's body
 * read back through `corpus doc show`, which is the projection every composer
 * reads (SHARED-022 Decision 1). Captured at seed time into the scenario's
 * refs, because a scorer is pure over the run record and may not read files.
 */
export async function readServedWeightTable(ctx: SeedContext): Promise<{
  readonly rows: readonly WeightTableRow[];
  readonly body: string;
  readonly key: string;
}> {
  const doc = await corpusJson(ctx, ["doc", "show", ORCHESTRATE_SKILL_DOC_ID], DocShowResultSchema);
  return { rows: readWeightTable(doc.body), body: doc.body, key: doc.key };
}

const WeightTableRowsSchema = z.array(
  z.object({ label: z.string(), key: z.string(), model: z.string() }),
);

export function weightTableRefs(rows: readonly WeightTableRow[]): string {
  return JSON.stringify(rows);
}

/** The seed-time table back out of a run record's refs. Empty when absent. */
export function weightTableFromRefs(record: RunRecord): readonly WeightTableRow[] {
  const raw = record.seed.refs.weightTable;
  if (raw === undefined) return [];
  const parsed = WeightTableRowsSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
}

// --- Reading the record ------------------------------------------------------

export function allEvents(record: RunRecord): readonly ObservedEvent[] {
  return Object.values(record.observation.queue.byStatus).flat();
}

/** The event's status directory, or `null` when it is nowhere at all. */
export function eventStatus(record: RunRecord, eventId: string): ObservedEvent["status"] | null {
  return allEvents(record).find((event) => event.id === eventId)?.status ?? null;
}

function payloadOf(event: ObservedEvent): Record<string, unknown> {
  const payload = event.parsed?.payload;
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Every observed event of one type, optionally narrowed to the thread its
 * payload names (`threadId` for the resident events, `lane` for
 * `lane.waiting`). This is how a scorer finds events the seed's responses
 * never returned — the server enqueues `resident.designated` and
 * `lane.waiting` without naming them in any response body.
 */
export function eventsOfType(
  record: RunRecord,
  type: string,
  threadId?: string,
): readonly ObservedEvent[] {
  return allEvents(record).filter((event) => {
    if (event.parsed?.type !== type) return false;
    if (threadId === undefined) return true;
    const payload = payloadOf(event);
    return payload.threadId === threadId || payload.lane === threadId;
  });
}

const JobLogLineSchema = z.object({
  ts: z.string().optional(),
  source: z.string().optional(),
  line: z.string(),
});

export interface JobLogLine {
  readonly ts: string | null;
  readonly source: string | null;
  readonly line: string;
}

/**
 * One event's job log, each JSONL line parsed to `{ts, source, line}`. A line
 * that is not the server's shape still surfaces, as `line` verbatim — a scorer
 * must see what was written, not only what parses.
 */
export function jobLogLines(record: RunRecord, eventId: string): readonly JobLogLine[] {
  const raw = record.observation.jobLogs[eventId] ?? [];
  return raw.map((entry) => {
    try {
      const parsed = JobLogLineSchema.parse(JSON.parse(entry));
      return { ts: parsed.ts ?? null, source: parsed.source ?? null, line: parsed.line };
    } catch {
      return { ts: null, source: null, line: entry };
    }
  });
}

/**
 * Whether any of the named events' logs carries a launch whose provenance is
 * this word — `stated` or `judged`, AGENT-063's two (AGENT-059 wrote the
 * grammar; AGENT-063 replaced its `defaulted` when the fixed default became a
 * judgment). The skill logs a launch on the event that put the lane in front
 * of it (the designation, or the `lane.waiting` it claimed), so a scorer asks
 * across that set.
 */
export function launchProvenanceLogged(
  record: RunRecord,
  eventIds: readonly string[],
  word: "stated" | "judged",
): boolean {
  return eventIds.some((eventId) =>
    jobLogLines(record, eventId).some((entry) => entry.line.includes(word)),
  );
}

export function threadById(record: RunRecord, threadId: string): ObservedThread | undefined {
  return record.observation.threads.find((thread) => thread.frontmatter?.id === threadId);
}

export function turnsBy(
  thread: ObservedThread,
  author: string,
): readonly ObservedThread["turns"][number][] {
  return thread.turns.filter((turn) => turn.author === author);
}

/**
 * One lane's launch, read the way story 2 established for a weightless
 * designation (AGENT-063) and shared with story 11, which reads two lanes and
 * compares them. All of it comes off the record: the launch-prompting events'
 * job logs (`resident.designated`, `lane.waiting`), and the thread's own
 * recorded turn models.
 */
export interface LaneLaunch {
  /**
   * The provenance word the launch log carries. `defaulted` is dead
   * vocabulary (AGENT-063), kept detectable so a revert to the fixed rule
   * shows up in a label rather than as a mute `unrecorded`.
   */
  readonly provenance: "judged" | "defaulted" | "stated" | "unrecorded";
  /**
   * The weight the launch *logged*: a declared row named on a judged line —
   * matched by model family, case-insensitively, the same tolerance
   * {@link recordedModelMatches} gives a turn's recorded model.
   */
  readonly loggedRow: WeightTableRow | null;
  /** The declared row the reply's recorded model matches, when it does. */
  readonly matchedRow: WeightTableRow | null;
  /**
   * What ran, for a label: the matched row's Model cell, or a parenthesised
   * description of why no row matched — no reply, several, an alien model.
   */
  readonly tier: string;
}

export function readLaneLaunch(
  record: RunRecord,
  threadId: string,
  rows: readonly WeightTableRow[],
): LaneLaunch {
  const launchEventIds = [
    ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const lines = launchEventIds.flatMap((eventId) => jobLogLines(record, eventId));
  const provenance = lines.some((entry) => entry.line.includes("judged"))
    ? "judged"
    : lines.some((entry) => entry.line.includes("defaulted"))
      ? "defaulted"
      : lines.some((entry) => entry.line.includes("stated"))
        ? "stated"
        : "unrecorded";

  const loggedRow =
    rows.find((row) =>
      lines.some(
        (entry) =>
          entry.line.includes("judged") &&
          entry.line.toLowerCase().includes(modelFamilyOf(row.model)),
      ),
    ) ?? null;

  const thread = threadById(record, threadId);
  const replies = thread === undefined ? [] : turnsBy(thread, "agent");
  const reply = replies.length === 1 ? (replies[0] ?? null) : null;
  const matchedRow =
    reply === null
      ? null
      : (rows.find((row) => recordedModelMatches(row.model, reply.model)) ?? null);

  const tier =
    reply === null
      ? replies.length === 0
        ? "(no reply)"
        : `(${String(replies.length)} replies)`
      : matchedRow === null
        ? `unmatched model "${reply.model ?? "(none)"}"`
        : matchedRow.model;
  return { provenance, loggedRow, matchedRow, tier };
}

/**
 * Whether the lane's launch was a judgment whose log told the truth: a
 * `judged` provenance, a logged row, and a reply whose recorded model matches
 * exactly that row. Which row it is stays deliberately unexamined — pinning a
 * tier would re-impose a default through the test (AGENT-063).
 */
export function laneJudgedTruthfully(lane: LaneLaunch): boolean {
  return (
    lane.provenance === "judged" &&
    lane.loggedRow !== null &&
    lane.matchedRow !== null &&
    lane.loggedRow.key === lane.matchedRow.key
  );
}

/** A finding sentence for an event that should have settled `processed`. */
export function expectProcessed(record: RunRecord, eventId: string, what: string): string | null {
  const status = eventStatus(record, eventId);
  if (status === "processed") return null;
  return status === null
    ? `${what} (${eventId}) is in no queue status directory`
    : `${what} (${eventId}) ended ${status}, not processed`;
}
