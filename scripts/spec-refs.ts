/**
 * INFRA-029 — every `§N` in the repository must name a section SPEC.md has.
 *
 * SHARED-046 corrected eleven citations of a **section 9.4 that does not
 * exist**: three in SPEC.md, one in `packages/contract/src/schemas/key.ts` — and
 * from there the generated client, so it shipped — plus server, UI and issue-file
 * copies. Nobody found it by reading. A cross-reference to a section that does
 * not exist reads exactly like one that does, so it survived four months and
 * eleven copies and was found by a structural sweep. The sweep does nothing to
 * stop the next one.
 *
 * **This file and its runner are inside the set they check, and take no
 * exemption from it.** Everything below therefore names the missing sections in
 * prose ("section 9.4") rather than in notation, which is exactly the correction
 * the check asks of everybody else: write a citation only when you mean one. The
 * alternative was to exclude `scripts/spec-refs.ts` by path, and a checker that
 * exempts itself is not a checker.
 *
 * ## Three decisions worth knowing before reading the code
 *
 * **The valid set is extracted from SPEC.md, never hand-kept.** A list of section
 * numbers maintained beside the document is the same class of defect this check
 * guards against: it would go stale silently and then certify a citation as good
 * because the list, not the spec, says the section exists.
 *
 * **A `§` means SPEC.md unless the text says which other document it means.**
 * `apps/ui/src/editor/markdown/` cites CommonMark and GFM section numbers beside
 * SPEC ones in the same files, so this cannot be settled by path. It is settled
 * by attribution: a citation whose line names another document immediately
 * before the `§` belongs to that document ({@link FOREIGN_DOCUMENTS}). The fix
 * for a false positive is therefore to say which document is meant, which is an
 * improvement to the text rather than a suppression.
 *
 * **Exclusions are anchored paths, never patterns.** An over-broad exclusion
 * makes this check pass vacuously, which is worse than not having it — the whole
 * failure mode being guarded against is a check nobody performs. Every exclusion
 * is a repo-root-anchored prefix and is listed in {@link EXCLUDED_PATHS} with its
 * reason; `checkSpecReferences` reports how much it scanned so a run that stopped
 * looking is visible in the success line rather than indistinguishable from a
 * clean tree.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { GENERATED_ARTIFACTS } from "./generated-artifacts.js";

/** The document whose headings are the authority. Repo-relative, POSIX. */
export const SPEC_PATH = "SPEC.md";

/**
 * Directory names that are build output, dependencies or test artefacts, skipped
 * wherever they occur. These are not repo content: a citation inside them is a
 * copy of one in source, so flagging it reports one defect twice.
 */
export const SKIPPED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-package",
  "build",
  "coverage",
  "coverage-raw",
  "test-results",
  "playwright-report",
]);

export interface ExcludedPath {
  /** Repo-root-anchored, POSIX. A trailing `/` means "this directory and below". */
  readonly path: string;
  readonly reason: string;
}

/**
 * Everything deliberately not read, anchored at the repository root.
 *
 * **Anchored, not globbed.** `issues/` spares the tracker at the repo root and
 * nothing else; a hypothetical `apps/server/src/issues/` is ordinary source and
 * stays covered. (The same anchoring rule the pack audit learned the hard way —
 * `data/**` there had to stay root-anchored so the workspace template's own
 * `data/` survived.)
 *
 * **Generated artefacts** come from the one inventory
 * `scripts/generated-artifacts.ts` already declares, so this list cannot drift
 * from the drift check's. They inherit their citations verbatim from the source
 * that generates them — `openapi.json` and `schema.generated.ts` carried the
 * historical section-9.4 citation only because
 * `packages/contract/src/schemas/key.ts` did — so reading them would report one
 * defect twice and point the reader at a file it is wrong to edit.
 *
 * **`issues/` is the deliberate one, and it is a real loss.** Issue files
 * legitimately contain citations that are wrong on purpose: `issues/shared/046-*`
 * and `048-*` quote the missing 9.4 in order to *describe* it,
 * `issues/infra/029-*` seeds 9.9 and 9.5 as examples of the defect, and several
 * files use the section sign for something else entirely (957–1002 is a line
 * range in `docs/cli.md`, 0 is the number of a section of an issue's own
 * verification log). The alternative — covering `issues/` with a
 * per-occurrence allowlist — was rejected: it needs a new entry every time
 * somebody writes an issue about a citation defect, and since a closed issue is
 * never edited again the allowlist could only grow, until it was the thing
 * certifying citations rather than SPEC.md. The loss is that a wrong citation is
 * not caught in the issue file it is drafted in. It is caught the moment it is
 * copied into SPEC.md, source, `assets/`, `docs/` or `design/`, which is the
 * moment it becomes something a user can be shown.
 */
export const EXCLUDED_PATHS: readonly ExcludedPath[] = [
  {
    path: "issues/",
    reason:
      "the issue tracker quotes wrong citations in order to document them (SHARED-046, INFRA-029) and is never edited again once written",
  },
  {
    path: ".claude/worktrees/",
    reason: "agent worktrees are checkouts of this repo, not repo content",
  },
  ...GENERATED_ARTIFACTS.flatMap((group) =>
    group.artifacts.map((artifact) => ({
      path: artifact,
      reason: `generated by \`${group.fix}\` — it inherits its citations from source, so flagging it reports one defect twice`,
    })),
  ),
];

/**
 * Documents other than SPEC.md whose sections this repo cites with `§`.
 *
 * Kept deliberately short: every entry is a name that has to appear immediately
 * before the `§` **on the same line**, and adding one is a decision to stop
 * checking that spelling. `apps/ui/src/editor/markdown/` is the only place this
 * arises — a markdown serializer discharging CommonMark and GFM proofs, in files
 * that cite SPEC.md sections in the very next comment, which is why this cannot
 * be a path exclusion.
 *
 * **Same line, not a lookback window.** A window over the enclosing comment
 * would have spared the one real instance without an edit, and would also spare
 * every SPEC citation that happens to follow a mention of CommonMark — a
 * suppression whose reach nobody can see at the point of use. The same-line rule
 * is auditable by reading the line, and its failure mode is a message telling
 * the author to name the document, which is a better comment than the one it
 * replaced.
 */
export const FOREIGN_DOCUMENTS: readonly string[] = ["CommonMark", "GFM"];

const FOREIGN_ATTRIBUTION = new RegExp(`(?:${FOREIGN_DOCUMENTS.join("|")})\\W{0,4}$`, "i");

/**
 * `§9.2`, `§ 9.2`, `` `§9.2` ``, `§9.2's` — the spellings the repo actually uses.
 *
 * The trailing `.` of a sentence is not consumed: `(?:\.\d+)*` needs a digit
 * after the dot, so `§9.2.` cites `9.2` rather than a `9.2.` nothing could match.
 */
const CITATION = /§[ \t]?(\d+(?:\.\d+)*)/g;

const HEADING = /^#{1,6}[ \t]+(\d+(?:\.\d+)*)\.?(?=[ \t]|$)/;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * Every numbered heading SPEC.md declares, as written.
 *
 * Fenced code blocks are skipped. Nothing in SPEC.md fences a numbered heading
 * today (its fenced `## user · …` lines fail the pattern anyway), but a fenced
 * example that did would mint a section the document does not have and then
 * certify citations to it — the exact shape of the defect this check exists for.
 *
 * Ancestors are **not** synthesised: `§9` is valid because `## 9. Server` is
 * written, not because `### 9.1` implies it. The set is what the document says.
 */
export function extractSpecSections(markdown: string): Set<string> {
  const sections = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = HEADING.exec(line);
    if (match !== null) sections.add(match[1] as string);
  }
  return sections;
}

export interface Citation {
  /** Repo-relative, POSIX. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** The digits after the `§`, e.g. `"9.4"`. */
  readonly section: string;
  /** The citation's line, trimmed, for the failure message. */
  readonly excerpt: string;
}

/**
 * Every SPEC citation in one file's text.
 *
 * A citation attributed to another document on the same line is not one of ours
 * and is not returned — see {@link FOREIGN_DOCUMENTS}.
 */
export function findCitations(path: string, text: string): Citation[] {
  const citations: Citation[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    CITATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CITATION.exec(line)) !== null) {
      if (FOREIGN_ATTRIBUTION.test(line.slice(0, match.index))) continue;
      citations.push({
        path,
        line: index + 1,
        section: match[1] as string,
        excerpt: excerptAround(line, match.index),
      });
    }
  }
  return citations;
}

const EXCERPT_BEFORE = 60;
const EXCERPT_AFTER = 60;

function excerptAround(line: string, at: number): string {
  const start = Math.max(0, at - EXCERPT_BEFORE);
  const end = Math.min(line.length, at + EXCERPT_AFTER);
  const body = line.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < line.length ? "…" : ""}`;
}

/** Whether a repo-relative POSIX path is deliberately not read. */
export function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some((excluded) =>
    excluded.path.endsWith("/") ? path.startsWith(excluded.path) : path === excluded.path,
  );
}

/**
 * Files big enough that reading them is not worth it. Nothing in the repo comes
 * near; the cap exists so a stray artefact cannot make a scan pathological, and
 * a file it skips is **counted and reported** rather than silently dropped —
 * this repo has been bitten three times by a check that quietly looked at
 * nothing (INFRA-022's manifest set, `version-sources`' globs, its `ls-tree`).
 */
export const MAX_SCANNED_BYTES = 4_000_000;

/**
 * Whether a file's bytes are text, decided by **strict UTF-8 validity**.
 *
 * Not by a NUL byte, and not by an extension allowlist. A NUL sniff is what this
 * was written as, and it misclassified `apps/server/src/watcher/self-writes.ts`
 * — ordinary TypeScript that joins a path and a digest with a NUL separator — as
 * binary, silently dropping a source file from the scan. An extension allowlist
 * has the same failure one step earlier: a file type nobody thought to list is
 * never read, and the check reports success for a tree it did not look at.
 * Compressed and image bytes are not valid UTF-8; source with a NUL in a
 * template literal is.
 */
export function isText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export interface SkippedFile {
  /** Repo-relative, POSIX. */
  readonly path: string;
  readonly reason: "not-utf8" | "oversized";
}

export interface ScanResult {
  readonly citations: readonly Citation[];
  readonly filesScanned: number;
  /** Files not read, in walk order. Reported rather than dropped in silence. */
  readonly filesSkipped: readonly SkippedFile[];
}

/**
 * Every citation under `root`, minus the excluded paths.
 *
 * The walk is a **deny-list**: a new top-level directory is scanned by default,
 * so nothing escapes coverage by being added later. {@link isText} decides what
 * can be read for the same reason — by what the bytes are, not by a list of
 * extensions somebody has to remember to extend.
 */
export function scanCitations(root: string): ScanResult {
  const citations: Citation[] = [];
  const filesSkipped: SkippedFile[] = [];
  let filesScanned = 0;

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split("\\").join("/");
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name) || isExcluded(`${path}/`)) continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || isExcluded(path)) continue;
      if (statSync(absolute).size > MAX_SCANNED_BYTES) {
        filesSkipped.push({ path, reason: "oversized" });
        continue;
      }
      const buffer = readFileSync(absolute);
      if (!isText(buffer)) {
        filesSkipped.push({ path, reason: "not-utf8" });
        continue;
      }
      filesScanned += 1;
      citations.push(...findCitations(path, buffer.toString("utf8")));
    }
  };

  walk(root);
  return { citations, filesScanned, filesSkipped };
}

export interface SpecReferenceReport {
  /** The sections SPEC.md declares, sorted. */
  readonly sections: readonly string[];
  /** Citations naming a section SPEC.md does not have. */
  readonly findings: readonly Citation[];
  readonly citationsChecked: number;
  readonly filesScanned: number;
  readonly filesSkipped: readonly SkippedFile[];
}

/** The whole check, over a repository root. */
export function checkSpecReferences(root: string): SpecReferenceReport {
  const sections = extractSpecSections(readFileSync(join(root, SPEC_PATH), "utf8"));
  const scan = scanCitations(root);
  return {
    sections: [...sections].sort(compareSections),
    findings: scan.citations.filter((citation) => !sections.has(citation.section)),
    citationsChecked: scan.citations.length,
    filesScanned: scan.filesScanned,
    filesSkipped: scan.filesSkipped,
  };
}

/** Numeric, component by component — so `§10` sorts after `§9`, not before `§2`. */
export function compareSections(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * What exists near the cited number, which is what the author needs.
 *
 * For a citation of 9.4 that is the subsections section 9 actually has; for a
 * bad top-level 17 it is the top-level sections. Naming the neighbourhood turns
 * "that section does not exist" into the correction itself, which is how the
 * historical 9.4 would have been repointed to 9.2 the day it was written.
 */
export function neighbourhood(section: string, sections: ReadonlySet<string>): string[] {
  const parts = section.split(".");
  const prefix = parts.length > 1 ? `${parts.slice(0, -1).join(".")}.` : "";
  const siblings = [...sections].filter(
    (candidate) =>
      candidate.startsWith(prefix) &&
      candidate !== prefix.slice(0, -1) &&
      !candidate.slice(prefix.length).includes("."),
  );
  return siblings.sort(compareSections);
}

/** One finding, saying what to do about it rather than only what it is. */
export function describeFinding(finding: Citation, sections: ReadonlySet<string>): string {
  const where = `${finding.path}:${String(finding.line)}`;
  return `${where} cites §${finding.section} — ${scopeOf(finding.section, sections)}\n      ${finding.excerpt}`;
}

function scopeOf(section: string, sections: ReadonlySet<string>): string {
  const parts = section.split(".");
  if (parts.length === 1) return `SPEC.md has ${asCitations(neighbourhood(section, sections))}`;
  const parent = parts.slice(0, -1).join(".");
  if (!sections.has(parent)) return `there is no §${parent} either`;
  const siblings = neighbourhood(section, sections);
  return siblings.length === 0
    ? `§${parent} has no subsections`
    : `§${parent} has ${asCitations(siblings)}`;
}

function asCitations(sections: readonly string[]): string {
  return sections.map((section) => `§${section}`).join(", ");
}
