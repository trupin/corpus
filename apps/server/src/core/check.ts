import type { TextQuoteSelector } from "@corpus/contract";
import type { ParsedDocument } from "./document.js";
import { DocumentParseError, duplicateKeysAt, parseDocument } from "./document.js";
import type { FileFrontmatter } from "./frontmatter.js";
import { isThreadFrontmatter, threadFrontmatter, validateFrontmatter } from "./frontmatter.js";
import { idPrefixForDocType, isAnchorId } from "./ids.js";
import { extractRefs } from "./refs.js";
import { duplicateTurnTimestamps } from "./turns.js";

/**
 * The corpus validator behind `corpus doc check` and every server mutation
 * (SPEC.md §14). The severity split is the whole point and is not negotiable:
 *
 * - **Errors** are structural lies — a document that cannot be read, an id that
 *   two documents claim, a thread pointing at an anchor nobody wrote. These
 *   break the projection's ability to describe the corpus.
 * - **Warnings** are legitimate states of an evolving corpus. An orphaned
 *   anchor is a normal outcome of editing (§6), and a `[[ref]]` to a document
 *   that does not exist *yet* is how a corpus grows (§5). Failing on either
 *   would punish the operator for using the system as designed.
 *
 * The module is I/O-free: the caller reads files and hands over the parses. It
 * is also independent of the anchor engine — resolution arrives injected, so
 * this and SERVER-002 land in either order.
 */

export const CHECK_CODES = {
  frontmatterUnparseable: "frontmatter-unparseable",
  frontmatterInvalid: "frontmatter-invalid",
  idPrefixMismatch: "id-prefix-mismatch",
  duplicateId: "duplicate-id",
  anchorMalformed: "anchor-malformed",
  duplicateAnchorId: "duplicate-anchor-id",
  threadParentMissing: "thread-parent-missing",
  threadAnchorMissing: "thread-anchor-missing",
  anchorClaimedTwice: "anchor-claimed-twice",
  duplicateTurnTimestamp: "duplicate-turn-timestamp",
  anchorUnresolved: "anchor-unresolved",
  anchorUnused: "anchor-unused",
  refUnresolved: "ref-unresolved",
} as const;

export type CheckCode = (typeof CHECK_CODES)[keyof typeof CHECK_CODES];

export type CheckSeverity = "error" | "warning";

export type CheckFinding = {
  readonly code: CheckCode;
  readonly severity: CheckSeverity;
  /** The offending document's id, or `null` when it could not be read. */
  readonly docId: string | null;
  readonly path: string;
  readonly detail: string;
};

/** One document handed to the checker: either it parsed, or it did not. */
export type CheckDocument =
  | { readonly path: string; readonly ok: true; readonly document: ParsedDocument }
  | { readonly path: string; readonly ok: false; readonly error: string };

/**
 * Signature SERVER-002's `resolveAnchor` satisfies directly. Injected rather
 * than imported so this module stays free of the anchor engine; when it is
 * absent, resolution-dependent warnings are simply not produced.
 *
 * It declares exactly the two arguments the checker passes and nothing more.
 * The checker has no `oldBody` and therefore no previous offset to offer, so
 * naming a third parameter here would over-specify the injection point: any
 * resolver whose third parameter is not a `number` would fail to compose even
 * though the checker would never supply one. Extra *optional* parameters on the
 * supplied function (the engine's `options` bag among them) remain assignable.
 */
export type AnchorResolver = (
  body: string,
  selector: TextQuoteSelector,
) => { start: number; end: number } | null;

export type CheckOptions = {
  readonly resolveAnchor?: AnchorResolver;
};

export type CheckReport = {
  readonly errors: readonly CheckFinding[];
  readonly warnings: readonly CheckFinding[];
};

/** Parse raw file bytes into a {@link CheckDocument}, recording failures instead of throwing. */
export const toCheckDocument = (path: string, raw: string): CheckDocument => {
  try {
    return { path, ok: true, document: parseDocument(raw, path) };
  } catch (error) {
    if (error instanceof DocumentParseError) return { path, ok: false, error: error.message };
    throw error;
  }
};

type LoadedDocument = {
  readonly path: string;
  readonly parsed: ParsedDocument;
  readonly frontmatter: FileFrontmatter;
};

const findings = () => {
  const all: CheckFinding[] = [];
  return {
    all,
    error(code: CheckCode, docId: string | null, path: string, detail: string): void {
      all.push({ code, severity: "error", docId, path, detail });
    },
    warn(code: CheckCode, docId: string | null, path: string, detail: string): void {
      all.push({ code, severity: "warning", docId, path, detail });
    },
  };
};

/**
 * A selector is well-formed when `exact` is a non-empty string and the optional
 * context fields, if written at all, are strings. This is checked against the
 * *raw* mapping rather than the validated one so a malformed entry reports as
 * the anchor rule it violates rather than as generic schema noise.
 */
const anchorEntryProblem = (entry: unknown): string | null => {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry))
    return "entry is not a mapping";
  const record = entry as Record<string, unknown>;
  const exact = record["exact"];
  if (typeof exact !== "string") return "`exact` is missing or not a string";
  if (exact === "") return "`exact` is empty";
  for (const field of ["prefix", "suffix"] as const) {
    const value = record[field];
    if (value !== undefined && typeof value !== "string") return `\`${field}\` is not a string`;
  }
  return null;
};

const checkAnchorEntries = (
  parsed: ParsedDocument,
  path: string,
  docId: string | null,
  report: ReturnType<typeof findings>,
): void => {
  for (const anchorId of duplicateKeysAt(parsed, ["anchors"])) {
    report.error(
      CHECK_CODES.duplicateAnchorId,
      docId,
      path,
      `anchor id \`${anchorId}\` is declared more than once`,
    );
  }
  const anchors = parsed.data["anchors"];
  if (anchors === undefined || anchors === null) return;
  if (typeof anchors !== "object" || Array.isArray(anchors)) {
    report.error(CHECK_CODES.anchorMalformed, docId, path, "`anchors` is not a mapping");
    return;
  }
  for (const [anchorId, entry] of Object.entries(anchors as Record<string, unknown>)) {
    if (!isAnchorId(anchorId)) {
      report.error(
        CHECK_CODES.anchorMalformed,
        docId,
        path,
        `anchor key \`${anchorId}\` is not an \`anc_*\` id`,
      );
      continue;
    }
    const problem = anchorEntryProblem(entry);
    if (problem !== null) {
      report.error(CHECK_CODES.anchorMalformed, docId, path, `anchor \`${anchorId}\`: ${problem}`);
    }
  }
};

/**
 * Check a whole corpus. Every document is checked independently first, then the
 * cross-document rules run over whatever parsed and validated — one bad file
 * never hides the rest of the corpus's problems.
 */
export const checkCorpus = (
  documents: readonly CheckDocument[],
  options: CheckOptions = {},
): CheckReport => {
  const report = findings();
  const loaded: LoadedDocument[] = [];
  // Every id the corpus contains, including documents whose frontmatter failed
  // validation. A document with one bad field still *exists*, so a thread
  // pointing at it must not also be accused of naming a missing parent — that
  // cascade would bury the one finding that actually needs fixing.
  const knownIds = new Set<string>();

  for (const entry of documents) {
    if (!entry.ok) {
      report.error(CHECK_CODES.frontmatterUnparseable, null, entry.path, entry.error);
      continue;
    }
    const rawId = entry.document.data["id"];
    const docId = typeof rawId === "string" ? rawId : null;
    if (docId !== null) knownIds.add(docId);

    // Anchor entries are checked against the raw mapping first: schema
    // validation would reject the whole document for one bad selector, and the
    // specific rule is what a §14 report is for.
    checkAnchorEntries(entry.document, entry.path, docId, report);

    const validated = validateFrontmatter(entry.document.data);
    if (!validated.ok) {
      for (const issue of validated.issues) {
        report.error(
          CHECK_CODES.frontmatterInvalid,
          docId,
          entry.path,
          `${issue.path}: ${issue.message}`,
        );
      }
      continue;
    }

    const expectedPrefix = idPrefixForDocType(validated.value.type);
    if (!validated.value.id.startsWith(`${expectedPrefix}_`)) {
      report.error(
        CHECK_CODES.idPrefixMismatch,
        docId,
        entry.path,
        `type \`${validated.value.type}\` requires an \`${expectedPrefix}_*\` id`,
      );
    }

    if (isThreadFrontmatter(entry.document.data)) {
      for (const ts of duplicateTurnTimestamps(entry.document.body)) {
        report.error(
          CHECK_CODES.duplicateTurnTimestamp,
          docId,
          entry.path,
          `turn timestamp \`${ts}\` is used by more than one turn`,
        );
      }
    }

    loaded.push({ path: entry.path, parsed: entry.document, frontmatter: validated.value });
  }

  const byId = new Map<string, LoadedDocument>();
  for (const document of loaded) {
    const existing = byId.get(document.frontmatter.id);
    if (existing !== undefined) {
      report.error(
        CHECK_CODES.duplicateId,
        document.frontmatter.id,
        document.path,
        `id \`${document.frontmatter.id}\` is also used by ${existing.path}`,
      );
      continue;
    }
    byId.set(document.frontmatter.id, document);
  }

  const anchorClaims = new Map<string, LoadedDocument>();
  for (const document of loaded) {
    const thread = threadFrontmatter(document.parsed.data);
    if (thread === null) continue;

    const parent = thread.parent === null ? null : byId.get(thread.parent);
    if (thread.parent !== null && !knownIds.has(thread.parent)) {
      report.error(
        CHECK_CODES.threadParentMissing,
        thread.id,
        document.path,
        `parent \`${thread.parent}\` does not exist in the corpus`,
      );
    }
    if (thread.anchor === null) continue;

    const claim = `${thread.parent ?? "<none>"}#${thread.anchor}`;
    const claimant = anchorClaims.get(claim);
    if (claimant !== undefined) {
      report.error(
        CHECK_CODES.anchorClaimedTwice,
        thread.id,
        document.path,
        `anchor \`${thread.anchor}\` is already claimed by ${claimant.frontmatter.id}`,
      );
    } else {
      anchorClaims.set(claim, document);
    }

    if (parent === null) {
      report.error(
        CHECK_CODES.threadAnchorMissing,
        thread.id,
        document.path,
        `anchor \`${thread.anchor}\` names no parent document`,
      );
      continue;
    }
    // A parent that exists but failed validation already carries its own
    // findings; its `anchors` map is not trustworthy enough to accuse the
    // thread with.
    if (parent === undefined) continue;
    if (!Object.hasOwn(parent.frontmatter.anchors, thread.anchor)) {
      report.error(
        CHECK_CODES.threadAnchorMissing,
        thread.id,
        document.path,
        `anchor \`${thread.anchor}\` is not declared in ${parent.frontmatter.id}`,
      );
    }
  }

  for (const document of loaded) {
    for (const [anchorId, selector] of Object.entries(document.frontmatter.anchors)) {
      if (!anchorClaims.has(`${document.frontmatter.id}#${anchorId}`)) {
        report.warn(
          CHECK_CODES.anchorUnused,
          document.frontmatter.id,
          document.path,
          `anchor \`${anchorId}\` has no thread referencing it`,
        );
      }
      if (options.resolveAnchor === undefined) continue;
      if (options.resolveAnchor(document.parsed.body, selector) === null) {
        report.warn(
          CHECK_CODES.anchorUnresolved,
          document.frontmatter.id,
          document.path,
          `anchor \`${anchorId}\` no longer resolves in the body; its thread is orphaned`,
        );
      }
    }

    for (const id of new Set(extractRefs(document.parsed.body).map((ref) => ref.id))) {
      if (!knownIds.has(id)) {
        report.warn(
          CHECK_CODES.refUnresolved,
          document.frontmatter.id,
          document.path,
          `reference \`[[${id}]]\` does not resolve to a document in the corpus`,
        );
      }
    }
  }

  return {
    errors: report.all.filter((finding) => finding.severity === "error"),
    warnings: report.all.filter((finding) => finding.severity === "warning"),
  };
};
