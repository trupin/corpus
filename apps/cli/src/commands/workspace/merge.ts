import { readFileSync, writeFileSync } from "node:fs";
import type { Doc } from "@corpus/contract";
import { CheckFailedError, InternalError, RefusedError, UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import { templateManifestPath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { normalizeIgnoredKeys } from "../../template/ignored-keys.js";
import {
  collectIncoming,
  shasOnDisk,
  workspaceFilePath,
  type ToolRoots,
} from "../../template/incoming.js";
import { readTemplateManifest, serializeManifest } from "../../template/manifest.js";
import { planUpgrade, type UpgradeDecision } from "../../template/plan.js";
import { runGit, type GitRunner } from "../init/git.js";
import { pruneBaselineStore, recoverBaselineBytes, storeBaselineBytes } from "./baseline.js";
import { locateTemplatePath } from "./diff.js";
import { mergeThreeWay, type MergeChunk, type ThreeWayMerge } from "./merge3.js";
import { unifiedDiff } from "./unified-diff.js";

/**
 * `corpus workspace merge <path>` — the three-way merge the upgrade's conflict
 * report points at but could not perform (CLI-082).
 *
 * A skill is owned twice by design: the workspace evolves it (the agent's
 * memory), and the template ships improved versions of the same file. Both
 * sides behaving correctly *guarantees* collision, and until this verb the
 * tool held all three copies — manifest baseline, workspace file, incoming
 * tool copy — while offering only a two-way diff. The operator's recourse was
 * a hand-run `git merge-file`, which silently dropped a local block older than
 * the recorded baseline. This verb is that merge, made honest:
 *
 * - **Clean merges are written through the server** (SPEC.md §2.2: the sole
 *   writer), as one authored act — this is a mutation like any other, and it
 *   runs against a live workspace, so the bootstrap-class exemption `upgrade`
 *   has does not apply here (sprint-024 P6).
 * - **Conflicting hunks are reported, never written**: the file stays
 *   byte-identical, and the hunks print with context and all three sides.
 * - **The baseline-only-hunk trap is named on the hunk**: a block present in
 *   the baseline and the workspace but absent from the tool's copy is either
 *   an upstream deletion or a pre-baseline local edit, and the tool cannot
 *   tell which — so it never picks a side (`merge3.ts`).
 *
 * ## Where the base bytes come from — and the recorded limitation
 *
 * The manifest stores the baseline's **sha256 only**, and the installed tool
 * ships no previous template versions. The one honest source of base *bytes*
 * is the workspace's own git history — `corpus init` and every upgrade commit
 * what they install — so the base is recovered from there and accepted only on
 * an exact hash match (`baseline.ts`). A baseline whose bytes are nowhere —
 * recorded by `--adopt` from bytes nobody committed, a rewritten history — is
 * a refusal, never a guess.
 *
 * ## What this verb merges — a second recorded limitation
 *
 * It merges the document **body**. Frontmatter is compared, not merged: the
 * server owns frontmatter serialization, and the write path (`PUT
 * /api/docs/{id}`) carries the body — so a tool-side frontmatter change
 * (beyond the ignored stamp/presentation keys) is reported as unresolved work
 * for `corpus doc edit`, never silently dropped and never written around the
 * server. For the same reason, only template files that are **documents** —
 * skills, agent personas, the seed documents — can be merged: the file's own
 * frontmatter `id:` is how the write is addressed. `README.md` and
 * `.gitignore` are nobody's documents, and merging them stays a hand job over
 * `corpus workspace diff`.
 *
 * ## After a clean merge, the baseline advances
 *
 * The merged file now contains everything the incoming copy has, so the
 * manifest entry advances to the **incoming copy's** shas — the tool's own
 * bytes, never the workspace's, so the safety property of `template/plan.ts`
 * holds. Without the advance the very next upgrade would re-report the
 * conflict this merge just resolved. A keep-mark (CLI-081) is untouched:
 * merging and keeping are separate acts on the same per-path state.
 */

const NOTHING_TO_MERGE = "nothing_to_merge";
const BASELINE_UNAVAILABLE = "merge_baseline_unavailable";

interface MergeSides {
  readonly header: string;
  readonly body: string;
}

/** A finding the verb will not resolve for the caller. */
interface FrontmatterFinding {
  /** Unified diff, workspace frontmatter → tool frontmatter. */
  readonly diff: string;
}

interface WorkspaceMergeReport {
  readonly root: string;
  readonly path: string;
  readonly toolVersion: string;
  /** `merged` wrote through the server; `unresolved` wrote nothing at all. */
  readonly outcome: "merged" | "unresolved";
  readonly docId: string | null;
  /** Chunks where the tool's copy decided the lines. */
  readonly incoming: number;
  /** Chunks where only this workspace's lines stand. */
  readonly local: number;
  readonly conflicts: readonly {
    readonly line: number;
    readonly base: string;
    readonly workspace: string;
    readonly tool: string;
  }[];
  readonly ambiguous: readonly { readonly line: number; readonly block: string }[];
  readonly frontmatter: FrontmatterFinding | null;
  /** The file is marked kept (CLI-081); merging did not change that. */
  readonly kept: boolean;
}

export interface MergeDependencies extends ToolRoots {
  readonly git?: GitRunner;
}

export async function runWorkspaceMerge(
  context: WorkspaceCommandContext,
  dependencies: MergeDependencies = {},
): Promise<void> {
  const root = context.workspace.root;
  const requested = context.args.get("path");

  const manifest = readTemplateManifest(templateManifestPath(root));
  const incoming = collectIncoming(dependencies);
  const decisions = planUpgrade(manifest?.files ?? [], incoming, (path) => shasOnDisk(root, path));

  const path = locateTemplatePath(
    requested,
    root,
    context.cwd,
    new Set(decisions.map((decision) => decision.path)),
  );
  const decision = decisions.find((candidate) => candidate.path === path);
  refuseNonMergeable(requested, path, decision);

  // A `keep-modified` verdict implies an incoming copy — `decide()` returns
  // `retired` the moment there is none — so this is a plan invariant.
  const source = incoming.find((file) => file.path === path);
  if (source === undefined) {
    throw new InternalError(`${path}: keep-modified verdict without an incoming copy.`);
  }

  if (decision.baseline === null) {
    throw new RefusedError(
      `${path} has no manifest baseline, and a three-way merge needs one — with no base, an ` +
        "old copy cannot be told from an edited one.",
      {
        code: BASELINE_UNAVAILABLE,
        hint:
          "Merge by hand from `corpus workspace diff " +
          `${path}\`, which shows what the tool's copy says.`,
      },
    );
  }

  const baseBytes = await recoverBaselineBytes(
    root,
    path,
    decision.baseline,
    dependencies.git ?? runGit,
  );
  if (baseBytes === null) {
    throw new RefusedError(
      `the baseline bytes for ${path} are not recoverable: the manifest records only their ` +
        "sha256, the tool ships no previous template versions, and no blob in this workspace's " +
        "git history matches the recorded hash. Merging against a guessed base is how edits " +
        "get destroyed, so nothing was merged.",
      {
        code: BASELINE_UNAVAILABLE,
        hint:
          "Merge by hand from `corpus workspace diff " +
          `${path}\`, then \`corpus workspace keep ${path}\` if the divergence is deliberate.`,
      },
    );
  }

  const base = split(baseBytes.toString("utf8"));
  const ours = split(readFileSync(workspaceFilePath(root, path), "utf8"));
  const theirs = split(readFileSync(source.from, "utf8"));

  const frontmatter = frontmatterFinding(path, base, ours, theirs);
  const merge = mergeThreeWay(base.body, ours.body, theirs.body);
  // The merge runs over the body, so its line numbers are body-relative; what
  // an operator opens is the **file**, frontmatter included, so every printed
  // number carries the header's lines (the same arithmetic the server's
  // `bodyStartLine` exists to spare people).
  const fileLine = (bodyLine: number): number => bodyLine + countLines(ours.header);

  const report: WorkspaceMergeReport = {
    root,
    path,
    toolVersion: context.version,
    outcome: merge.clean && frontmatter === null ? "merged" : "unresolved",
    docId: documentId(ours.header),
    incoming: merge.incoming,
    local: merge.local,
    conflicts: merge.chunks.flatMap((chunk) =>
      chunk.kind === "conflict"
        ? [
            {
              line: fileLine(chunk.oursLine),
              base: chunk.base.join(""),
              workspace: chunk.ours.join(""),
              tool: chunk.theirs.join(""),
            },
          ]
        : [],
    ),
    ambiguous: merge.chunks.flatMap((chunk) =>
      chunk.kind === "ambiguous-deletion"
        ? [{ line: fileLine(chunk.oursLine), block: chunk.base.join("") }]
        : [],
    ),
    frontmatter,
    kept: decision.kept,
  };

  if (report.outcome === "unresolved") {
    context.out.emit(report);
    renderUnresolved(context, report, merge, fileLine);
    throw new CheckFailedError(
      `${path}: ${unresolvedSummary(report)} — nothing was written, the file is untouched.`,
      { hint: "The hunks above carry all three sides; resolve them with `corpus doc edit`." },
    );
  }

  const mergedBody = merge.result;
  if (mergedBody === null) {
    throw new InternalError(`${path}: a clean merge produced no result.`);
  }
  if (mergedBody === ours.body) {
    throw new RefusedError(
      `${path} already contains everything the tool's copy adds — there is nothing to merge.`,
      { code: NOTHING_TO_MERGE, hint: DIFF_HINT },
    );
  }

  const docId = report.docId;
  if (docId === null) {
    throw new RefusedError(
      `${path} carries no frontmatter \`id:\`, so it is not a document the server can write — ` +
        "and the server is the sole writer, so this verb will not write it either.",
      {
        code: "merge_not_a_document",
        hint:
          "Merge it by hand from `corpus workspace diff " +
          `${path}\` and your editor; the merge machinery only writes documents.`,
      },
    );
  }

  const doc = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id: docId } } }),
  );
  assertSameDocument(doc, docId, path);

  await context.client.request((api) =>
    api.PUT("/api/docs/{id}", {
      params: { path: { id: docId } },
      body: { key: doc.key, body: mergedBody },
    }),
  );

  advanceBaseline(root, path, source);

  context.out.emit(report);
  context.out.line(
    `merged ${path}: ${plural(merge.incoming, "change")} from corpus ${context.version} joined ` +
      `${plural(merge.local, "local change", "local changes")}, written through the server as ` +
      `${context.actor} in one commit.`,
  );
  if (report.kept) {
    context.out.line(
      "  still kept: upgrades keep skipping it — `corpus workspace unkeep " +
        `${path}\` is a separate act.`,
    );
  }
}

/**
 * Every verdict that is not `keep-modified` has nothing to three-way: the
 * refusal says which case it is and which verb already handles it, so "nothing
 * to merge" never reads as "nothing to do".
 */
function refuseNonMergeable(
  requested: string,
  path: string,
  decision: UpgradeDecision | undefined,
): asserts decision is UpgradeDecision {
  if (decision === undefined) {
    // The same refusal `corpus workspace diff` gives an unknown path, and the
    // same exit code (2): "no difference" and "nobody looked" must not blur,
    // and neither must "nothing to merge" and "nothing is known about this".
    throw new UsageError(
      `"${requested}" is not a file the corpus tool installs, so there is nothing to merge it ` +
        "with.",
      {
        hint:
          "This verb merges template-provenance paths only, named as `corpus workspace " +
          "upgrade` prints them. Run `corpus workspace diff` to list the paths in conflict.",
      },
    );
  }
  const refuse = (message: string): never => {
    throw new RefusedError(`${path} ${message}`, { code: NOTHING_TO_MERGE, hint: DIFF_HINT });
  };
  switch (decision.action) {
    case "keep-modified":
      return;
    case "current":
      refuse("is already identical to the tool's copy — there is nothing to merge.");
      break;
    case "keep-silent":
      refuse(
        "diverges, but the tool's copy has not moved since the baseline — your edits are the " +
          "only side, and they are already in place.",
      );
      break;
    case "update":
      refuse(
        "was never edited in this workspace, so there is nothing of yours to merge — " +
          "`corpus workspace upgrade` takes the tool's copy whole.",
      );
      break;
    case "install":
      refuse(
        "is not in this workspace, so there is nothing to merge onto — `corpus workspace " +
          "upgrade` installs it.",
      );
      break;
    case "restore-candidate":
      refuse(
        "was deleted from this workspace — `corpus workspace upgrade --restore` reinstalls it.",
      );
      break;
    case "retired":
      refuse("is no longer shipped by the tool, so there is no incoming side to merge.");
      break;
  }
}

const DIFF_HINT = "Run `corpus workspace diff` to list the paths that do have a conflict to merge.";

/** The file split exactly where the server splits it (`core/document.ts`). */
function split(text: string): MergeSides {
  const match = /^---\r?\n[\s\S]*?(?:\r?\n)?---\r?\n/.exec(text);
  if (match === null) return { header: "", body: text };
  return { header: match[0], body: text.slice(match[0].length) };
}

/**
 * The tool moved this file's frontmatter (beyond the ignored stamp and
 * presentation keys), and this verb writes bodies only — so the change is
 * reported for `corpus doc edit`, never merged and never dropped in silence.
 * Nothing to report when the tool's frontmatter still matches the baseline's,
 * or already matches the workspace's: the workspace's own frontmatter stands.
 */
function frontmatterFinding(
  path: string,
  base: MergeSides,
  ours: MergeSides,
  theirs: MergeSides,
): FrontmatterFinding | null {
  const normalizedTheirs = normalizeIgnoredKeys(theirs.header);
  if (normalizedTheirs === normalizeIgnoredKeys(base.header)) return null;
  if (normalizedTheirs === normalizeIgnoredKeys(ours.header)) return null;
  return {
    diff: unifiedDiff(ours.header, theirs.header, {
      from: `workspace/${path} (frontmatter)`,
      to: `tool/${path} (frontmatter)`,
    }).text,
  };
}

function documentId(header: string): string | null {
  const match = /^id:[ \t]*(\S+)[ \t]*\r?$/m.exec(header);
  return match?.[1] ?? null;
}

/**
 * The `id:` in the file must name the document the server holds **at this
 * path** — an id pasted from elsewhere would otherwise write the merge into an
 * unrelated document.
 */
function assertSameDocument(doc: Doc, docId: string, path: string): void {
  if (doc.path === path) return;
  throw new RefusedError(
    `the \`id:\` in ${path} names ${docId}, but the server holds that document at ` +
      `${doc.path} — writing the merge there would hit the wrong file, so nothing was written.`,
    {
      code: "merge_wrong_document",
      hint: "Fix the file's `id:` frontmatter (compare `corpus doc show " + `${docId}\`).`,
    },
  );
}

/**
 * A clean merge leaves the file holding everything the incoming copy has, so
 * the manifest entry advances to the incoming copy's shas — otherwise the next
 * upgrade re-reports the conflict this merge just resolved. The incoming shas
 * are the tool's own bytes, never the workspace's, so a still-diverged file
 * still reads modified (the `template/plan.ts` safety property). The keep-mark
 * and every unknown key on the entry are carried unchanged.
 */
function advanceBaseline(
  root: string,
  path: string,
  source: { readonly sha256: string; readonly normalizedSha256: string; readonly from: string },
): void {
  const manifestPath = templateManifestPath(root);
  const manifest = readTemplateManifest(manifestPath);
  if (manifest === undefined) return;
  // The advanced baseline's bytes are the tool's, never committed into this
  // workspace — so they go into the baseline store, or the *next* merge of
  // this same file would find its base unrecoverable (`baseline.ts`).
  storeBaselineBytes(root, readFileSync(source.from));
  const files = manifest.files.map((entry) =>
    entry.path === path
      ? { ...entry, sha256: source.sha256, normalizedSha256: source.normalizedSha256 }
      : entry,
  );
  const next = { ...manifest, files };
  writeFileSync(manifestPath, serializeManifest(next), "utf8");
  pruneBaselineStore(root, next);
}

function unresolvedSummary(report: WorkspaceMergeReport): string {
  const parts: string[] = [];
  if (report.conflicts.length > 0) {
    parts.push(plural(report.conflicts.length, "conflicting hunk"));
  }
  if (report.ambiguous.length > 0) {
    parts.push(`${plural(report.ambiguous.length, "hunk")} the tool cannot decide`);
  }
  if (report.frontmatter !== null) parts.push("a tool-side frontmatter change");
  return parts.join(", ");
}

/** Context lines shown around each unresolved hunk, from the neighbouring chunks. */
const MERGE_CONTEXT_LINES = 3;

/**
 * Git-style conflict markers, built by repetition rather than written out: the
 * seven-angle-bracket opener followed by a word would read as a heredoc opener
 * to the hygiene scan (`hygiene.test.ts`), whose job is to keep `EOF` heredocs
 * out of everything an agent might imitate.
 */
const OURS_MARKER = "<".repeat(7);
const BASE_MARKER = "|".repeat(7);
const THEIRS_MARKER = ">".repeat(7);

function renderUnresolved(
  context: WorkspaceCommandContext,
  report: WorkspaceMergeReport,
  merge: ThreeWayMerge,
  fileLine: (bodyLine: number) => number,
): void {
  const out = context.out;
  out.line(`${report.path}: ${unresolvedSummary(report)} — nothing was written.`);

  merge.chunks.forEach((chunk, index) => {
    if (chunk.kind === "conflict") {
      out.line("");
      out.line(`conflict at workspace/${report.path}:${String(fileLine(chunk.oursLine))}`);
      renderContext(out.line.bind(out), merge.chunks, index, "before");
      out.line(`  ${OURS_MARKER} workspace (your copy)`);
      for (const line of chunk.ours) out.line(`  ${trimEol(line)}`);
      out.line(`  ${BASE_MARKER} baseline (what the manifest recorded)`);
      for (const line of chunk.base) out.line(`  ${trimEol(line)}`);
      out.line("  =======");
      for (const line of chunk.theirs) out.line(`  ${trimEol(line)}`);
      out.line(`  ${THEIRS_MARKER} tool (corpus ${report.toolVersion})`);
      renderContext(out.line.bind(out), merge.chunks, index, "after");
    }
    if (chunk.kind === "ambiguous-deletion") {
      out.line("");
      out.line(
        `undecidable at workspace/${report.path}:${String(fileLine(chunk.oursLine))} — this block is in ` +
          "the recorded baseline and in this workspace, and absent from the tool's copy. That " +
          "is either an upstream deletion or a local edit older than the recorded baseline, " +
          "and the tool cannot tell which — so no side is picked and the block stays:",
      );
      for (const line of chunk.base) out.line(`    ${trimEol(line)}`);
      out.line("  Delete it yourself if the tool's copy is right; keep it if it is yours.");
    }
  });

  if (report.frontmatter !== null) {
    out.line("");
    out.line(
      "the tool also changed this file's frontmatter, which this verb does not merge — the " +
        "server owns frontmatter, so apply what you want of it with `corpus doc edit`:",
    );
    for (const line of report.frontmatter.diff.replace(/\n$/, "").split("\n")) {
      out.line(`  ${line}`);
    }
  }
}

function renderContext(
  line: (text: string) => void,
  chunks: readonly MergeChunk[],
  index: number,
  side: "before" | "after",
): void {
  const neighbour = chunks[side === "before" ? index - 1 : index + 1];
  if (neighbour === undefined) return;
  if (neighbour.kind === "conflict" || neighbour.kind === "ambiguous-deletion") return;
  const lines = neighbour.lines;
  const slice =
    side === "before"
      ? lines.slice(Math.max(0, lines.length - MERGE_CONTEXT_LINES))
      : lines.slice(0, MERGE_CONTEXT_LINES);
  for (const text of slice) line(`  ${trimEol(text)}`);
}

/** Lines a text spans — one per terminator, so a fence-closed header counts whole. */
function countLines(text: string): number {
  return text.split("\n").length - 1;
}

function trimEol(line: string): string {
  return line.endsWith("\n") ? line.slice(0, -1) : line;
}

export const workspaceMergeCommand: WorkspaceCommandSpec = {
  name: "merge",
  summary: "Three-way merge a conflicted template file: baseline, your copy, the tool's copy.",
  description:
    "A skill is owned twice by design — the workspace evolves it as the agent's memory, and the " +
    "template ships improved versions of the same file — so collision is guaranteed, and " +
    "`corpus workspace upgrade` reports it as a conflict it will not resolve. This verb is the " +
    "resolution: a three-way merge of the manifest's recorded baseline, the workspace's copy, " +
    "and the copy the installed tool ships.\n\n" +
    "**A clean merge is written through the server** — the sole writer — as one attributed " +
    "commit, and the manifest baseline then advances to the tool's copy so the next upgrade " +
    "does not re-report the conflict this merge just resolved. **Conflicting hunks are " +
    "reported, never written**: the file stays byte-identical, and each hunk prints with " +
    "context and all three sides.\n\n" +
    "**One hunk shape is never auto-resolved, and it is a trap worth naming**: a block present " +
    "in the baseline and in your copy but **absent from the tool's copy** is either an " +
    "upstream deletion or a local edit older than the recorded baseline — the baseline of a " +
    "modified file can itself be post-modification — and the tool cannot tell which. A plain " +
    "`git merge-file` silently deletes such a block; this verb reports it, picks no side, and " +
    "leaves the decision to you.\n\n" +
    "The base **bytes** are recovered from the workspace's own git history (the manifest " +
    "records only a hash, and the tool ships no previous templates), accepted only on an exact " +
    "hash match — an unrecoverable baseline is a refusal, never a guess. The merge covers the " +
    "document **body**; a tool-side frontmatter change is reported for `corpus doc edit`, and " +
    "only template files that are documents (a frontmatter `id:`) can be written at all. A " +
    "kept file (`corpus workspace keep`) merges on request, and merging does not clear the " +
    "mark.\n\n" +
    "Exit codes: **0** — merged and written. **6** — unresolved hunks reported, nothing " +
    "written. **7** — nothing to merge (already current, never edited here, no incoming copy), " +
    "or a baseline whose bytes cannot be recovered.",
  args: [
    {
      name: "path",
      required: true,
      description:
        "The conflicted template file, workspace-relative as `corpus workspace upgrade` and " +
        "`corpus workspace diff` print it.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus workspace merge .claude/skills/comment/SKILL.md",
      description:
        "Merge the tool's improvements into an evolved skill: clean hunks are written through " +
        "the server, conflicts print with all three sides.",
    },
    {
      command: "corpus workspace merge .claude/skills/comment/SKILL.md --json",
      description:
        'One JSON value: `{"root":"/home/me/notes","path":".claude/skills/comment/SKILL.md",' +
        '"toolVersion":"0.34.0","outcome":"merged","docId":"doc_skillcomment","incoming":2,' +
        '"local":3,"conflicts":[],"ambiguous":[],"frontmatter":null,"kept":false}` — ' +
        "`conflicts` and `ambiguous` carry each unresolved hunk with its line and sides.",
    },
  ],
  handler: (context) => runWorkspaceMerge(context),
};
