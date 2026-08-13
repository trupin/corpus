/**
 * INFRA-027 — the issue tracker's two halves must agree.
 *
 * `issues/PLAN.md` carries a row per issue and `issues/<domain>/NNN-*.md` carries
 * the issue. Both hold a status, nothing kept them in step, and every phase in
 * this repo's history has left some drift: the update is a manual step at the end
 * of an issue, which is exactly when attention is lowest.
 *
 * ## Two decisions worth knowing before reading the code
 *
 * **An issue's ID comes from its own `# [ID]` heading, never from its path.**
 * The obvious resolver — lowercase the prefix, look in `issues/<prefix>/` — is
 * wrong here, and wrong in a way that hides: `AGENT-*` lives under
 * `issues/agent-runtime/` for 004–026 and `issues/agent/` for 001–003. This
 * issue's own census used the path rule and reported 21 issues missing that were
 * sitting on disk. Reading the heading needs no mapping, cannot fall out of date
 * with a new domain directory, and makes duplicate-ID detection fall out for
 * free rather than being a second pass.
 *
 * **An unrecognised status fails rather than defaulting.** A first attempt at the
 * cleanup this check replaces used `"signed" in status` as its done-test and
 * mis-flipped two rows — one of which read *"needs the one-line SPEC amendment
 * below signed off first"*, i.e. blocked. A checker that is too loose is worse
 * than none, because it will be trusted.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `issues/TEMPLATE.md`'s vocabulary, and the whole of it.
 *
 * `closed` is **resolved without landing** — superseded, obsoleted, or
 * implemented and then reverted. It was added by this issue rather than forcing
 * its two instances into `done`, which would have written a falsehood into the
 * tracker: `SERVER-055` wired SPEC §6's fuzzy rung and was reverted for
 * misattaching threads (the read path still says so in a comment), and
 * `INFRA-024` was superseded by `INFRA-025` rather than fixed. `done` tells a
 * reader the behaviour is in the tree. For these it is deliberately not.
 */
export const ISSUE_STATUSES = ["todo", "in_progress", "done", "blocked", "closed"] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type Finding =
  | {
      readonly kind: "status-disagreement";
      readonly id: string;
      readonly plan: IssueStatus;
      readonly file: IssueStatus;
      readonly path: string;
    }
  | { readonly kind: "unclassifiable-plan-status"; readonly id: string; readonly raw: string }
  | {
      readonly kind: "unclassifiable-file-status";
      readonly id: string;
      readonly raw: string;
      readonly path: string;
    }
  | { readonly kind: "missing-issue-file"; readonly id: string }
  | { readonly kind: "missing-plan-row"; readonly id: string; readonly path: string }
  | { readonly kind: "duplicate-plan-row"; readonly id: string; readonly count: number }
  | { readonly kind: "bare-closed"; readonly id: string; readonly path: string }
  | {
      readonly kind: "duplicate-issue-file";
      readonly id: string;
      readonly paths: readonly string[];
    };

export interface PlanRow {
  readonly id: string;
  readonly rawStatus: string;
}

export interface IssueFile {
  readonly id: string;
  readonly path: string;
  readonly rawStatus: string;
}

/**
 * The status word, or `undefined` when the text does not start with one.
 *
 * Prose after the word is normal and useful — `done — SIGNED 2026-08-12 and
 * applied` says more than `done` — so the parser reads the **leading token** and
 * lets the rest stand. What it must not do is find a vocabulary word anywhere in
 * the line: `todo — signed by the user; apply at kickoff` is `todo`, and a line
 * reading *"needs the amendment signed off first"* is not `done` because it
 * contains a word that appears in some done statuses.
 *
 * Markdown emphasis is stripped by {@link withoutEmphasis} first, because
 * several files bold the word (`**done — signed and applied.**`) and the
 * emphasis is presentation.
 */
export function classifyStatus(raw: string): IssueStatus | undefined {
  const text = withoutEmphasis(raw).toLowerCase();
  for (const status of ISSUE_STATUSES) {
    // Accept the word itself, and either spelling of the two-word one.
    for (const spelling of status === "in_progress" ? ["in_progress", "in progress"] : [status]) {
      if (text === spelling) return status;
      if (!text.startsWith(spelling)) continue;
      // Only a separator may follow: prose is a gloss on the status, never a
      // different status that happens to share a prefix.
      const rest = text.slice(spelling.length);
      if (/^\s*([—:(-]|$)/.test(rest)) return status;
    }
  }
  return undefined;
}

/**
 * A status line with its markdown emphasis removed and nothing else changed.
 *
 * `*` and a backtick are never part of a status word, so they go **wherever they
 * sit** — which matters because the marker can close *around the word* and leave
 * the gloss outside it: `**closed** — superseded` is a spelling this repo
 * actually uses, and stripping only the edges leaves `closed** — superseded`,
 * which the parser below then refuses as unclassifiable.
 *
 * `_` is stripped only at the **edges**, because `in_progress` carries one in
 * the middle and it is part of the word — a global strip turned it into
 * `inprogress` and rejected the two files that spell the status exactly as
 * `issues/TEMPLATE.md` does.
 */
export function withoutEmphasis(raw: string): string {
  return raw
    .replace(/[*`]/g, "")
    .trim()
    .replace(/^_+|_+$/g, "")
    .trim();
}

const ROW = /^\|\s*([A-Z]+-\d+)\s*\|([^|]*)\|([^|]*)\|/;

/**
 * Every `| ID | Title | Status | …` row of `issues/PLAN.md`, in order.
 *
 * The header and separator rows fail the ID pattern, so no explicit skip is
 * needed; a phase's prose between tables is likewise not a row.
 */
export function parsePlan(markdown: string): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const line of markdown.split("\n")) {
    const match = ROW.exec(line);
    if (match === null) continue;
    rows.push({ id: match[1] as string, rawStatus: (match[3] as string).trim() });
  }
  return rows;
}

const HEADING = /^#\s*\[([A-Z]+-\d+)\]/;

/** The `## Status` section's first non-empty line, which is where the word is. */
function statusOf(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^##\s+Status\s*$/.test(line.trim()));
  if (start === -1) return "";
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (line.startsWith("#")) break;
    return line.trim();
  }
  return "";
}

/**
 * Every issue file under `issues/`, keyed by the ID **it declares**.
 *
 * `issues/PLAN.md` and `issues/TEMPLATE.md` are not issues; neither is anything
 * under `evals/` or `sprints/`, which are verdicts and contracts rather than
 * tracked work. Everything else that declares an ID in its heading is one.
 */
export function readIssueFiles(issuesDir: string): IssueFile[] {
  const found: IssueFile[] = [];
  const skip = new Set(["evals", "sprints"]);
  for (const entry of readdirSync(issuesDir)) {
    const dir = join(issuesDir, entry);
    if (skip.has(entry) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      const markdown = readFileSync(path, "utf8");
      const heading = HEADING.exec(markdown.split("\n")[0] ?? "");
      if (heading === null) continue;
      found.push({
        id: heading[1] as string,
        path: relative(issuesDir, path),
        rawStatus: statusOf(markdown),
      });
    }
  }
  return found;
}

/**
 * Everything the two halves disagree about, in a stable order.
 *
 * Every shape is reported rather than the first one found: a check that stops at
 * the first failure turns a single sweep into as many runs as there are
 * problems, and this one is meant to be fixed in one pass.
 */
export function compare(rows: readonly PlanRow[], files: readonly IssueFile[]): Finding[] {
  const findings: Finding[] = [];

  const byId = new Map<string, IssueFile[]>();
  for (const file of files) {
    const list = byId.get(file.id);
    if (list === undefined) byId.set(file.id, [file]);
    else list.push(file);
  }

  // Two files claiming one ID. Reported before anything else because every other
  // answer about that ID is ambiguous until it is settled: a dependency edge
  // naming it resolves to whichever file the reader opens first.
  const duplicated = new Set<string>();
  for (const [id, list] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue;
    duplicated.add(id);
    findings.push({
      kind: "duplicate-issue-file",
      id,
      paths: list.map((file) => file.path).sort(),
    });
  }

  // Two rows for one id, which is the same ambiguity one file over and matters
  // for the same reason: the orchestration loop reads PLAN to decide what is
  // ready, so a duplicated id gives it two answers. Live when this check was
  // written — `SERVER-090` appeared twice with different Priority *and*
  // Dependencies (PR #46 review).
  const rowCounts = new Map<string, number>();
  for (const row of rows) rowCounts.set(row.id, (rowCounts.get(row.id) ?? 0) + 1);
  const duplicatedRows = new Set<string>();
  for (const [id, count] of [...rowCounts].sort(([a], [b]) => a.localeCompare(b))) {
    if (count < 2) continue;
    duplicatedRows.add(id);
    findings.push({ kind: "duplicate-plan-row", id, count });
  }

  const inPlan = new Set<string>();
  for (const row of rows) {
    inPlan.add(row.id);
    if (duplicated.has(row.id) || duplicatedRows.has(row.id)) continue;
    const planStatus = classifyStatus(row.rawStatus);
    if (planStatus === undefined) {
      findings.push({ kind: "unclassifiable-plan-status", id: row.id, raw: row.rawStatus });
      continue;
    }
    const file = byId.get(row.id)?.[0];
    if (file === undefined) {
      findings.push({ kind: "missing-issue-file", id: row.id });
      continue;
    }
    const fileStatus = classifyStatus(file.rawStatus);
    if (fileStatus === undefined) {
      findings.push({
        kind: "unclassifiable-file-status",
        id: row.id,
        raw: file.rawStatus,
        path: file.path,
      });
      continue;
    }
    // `issues/TEMPLATE.md` says `closed` "always carries prose saying which",
    // and a rule with nothing behind it is the shape this check was filed
    // against. `closed` is the one status whose bare form is uninformative:
    // superseded, obsoleted and reverted are different fates with different
    // consequences for a reader, and the word alone names none of them.
    //
    // Emphasis is stripped from **both** edges before the gloss is read.
    // Stripping only the leading marker left `**closed**` with a gloss of `**`,
    // which is not empty and so passed — defeated by the very convention the
    // parser above exists to handle, since several files bold the word (PR #46
    // review).
    if (fileStatus === "closed") {
      // The same normalisation the classifier used, so the two can never
      // disagree about where the word ends.
      const gloss = withoutEmphasis(file.rawStatus).slice("closed".length).trim();
      if (gloss.replace(/^[—:(-]+/, "").trim() === "") {
        findings.push({ kind: "bare-closed", id: row.id, path: file.path });
        continue;
      }
    }
    if (fileStatus !== planStatus) {
      findings.push({
        kind: "status-disagreement",
        id: row.id,
        plan: planStatus,
        file: fileStatus,
        path: file.path,
      });
    }
  }

  for (const file of files) {
    if (inPlan.has(file.id) || duplicated.has(file.id)) continue;
    findings.push({ kind: "missing-plan-row", id: file.id, path: file.path });
  }

  return findings;
}

/** One line per finding, saying what to do about it rather than only what it is. */
export function describe(finding: Finding): string {
  switch (finding.kind) {
    case "status-disagreement":
      return `${finding.id}: PLAN says \`${finding.plan}\`, ${finding.path} says \`${finding.file}\` — settle which is true, then make both say it`;
    case "unclassifiable-plan-status":
      return `${finding.id}: PLAN status "${finding.raw}" is not one of ${ISSUE_STATUSES.join(", ")} — say which it is rather than inventing a word`;
    case "unclassifiable-file-status":
      return `${finding.id}: ${finding.path} status "${finding.raw}" is not one of ${ISSUE_STATUSES.join(", ")} — prose after the word is fine, a different word is not`;
    case "missing-issue-file":
      return `${finding.id}: a PLAN row with no issue file — file it, or drop the row if the work never existed`;
    case "missing-plan-row":
      return `${finding.id}: ${finding.path} has no PLAN row — add it to the phase it belongs to`;
    case "bare-closed":
      return `${finding.id}: ${finding.path} is \`closed\` with no reason — say which fate it was (superseded, obsoleted, or implemented and reverted), because the word alone names none of them`;
    case "duplicate-plan-row":
      return `${finding.id}: ${String(finding.count)} PLAN rows for one id — the readiness rule reads PLAN, so this is two answers to "is it ready"; keep the row from the phase the work landed in and drop the rest`;
    case "duplicate-issue-file":
      return `${finding.id}: claimed by ${finding.paths.length} files (${finding.paths.join(", ")}) — renumber all but one; a dependency naming this ID is ambiguous until you do`;
  }
}
