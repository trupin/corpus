import type { TextQuoteSelector } from "@corpus/contract";
import { unterminatedFence } from "@corpus/contract";
import type { ParsedDocument } from "./document.js";
import { DocumentParseError, bodyStartLine, duplicateKeysAt, parseDocument } from "./document.js";
import type { FileFrontmatter, FrontmatterIssue } from "./frontmatter.js";
import { isThreadFrontmatter, threadFrontmatter, validateFrontmatter } from "./frontmatter.js";
import { idPrefixForDocType, isAnchorId } from "./ids.js";
import { extractRefs } from "./refs.js";
import { residentProblem } from "./resident.js";
import { duplicateTurnTimestamps } from "./turns.js";

/**
 * The corpus validator behind `corpus doc check` and every server mutation
 * (SPEC.md §11). The severity split is the whole point and is not negotiable:
 *
 * - **Errors** are structural lies — a document that cannot be read, an id that
 *   two documents claim, a thread pointing at an anchor nobody wrote, an anchor
 *   entry no thread claims. These break the projection's ability to describe the
 *   corpus. A body whose fenced code block never closes joins them (SERVER-066):
 *   it reads perfectly well and quietly swallows everything after it, threads'
 *   turns included — see {@link checkUnterminatedFence} for why that is an error
 *   and why it still never blocks a write.
 * - **Warnings** are exactly the two states §11 carves out, and no others: an
 *   anchor that is well-formed but no longer resolves (an orphaned thread — a
 *   normal outcome of editing, §6), and a `[[ref]]` to a document that does not
 *   exist *yet* (how a corpus grows, §5). Failing on either would punish the
 *   operator for using the system as designed.
 *
 * **Frontmatter means both vocabularies, not just Corpus's.** §7: "Corpus's
 * frontmatter fields … coexist with Claude Code's (`name`, `description`) in the
 * same YAML block; `corpus doc check` validates both sets." Under `.claude/`
 * those two sets trade places — §5's canonical block is no longer *required* and
 * Claude Code's two fields are — and both halves are decided by the one
 * `claudeCodeRoot` seam, so a rule and its waiver can never contradict each
 * other. They share `frontmatter-invalid` because they are the same finding
 * about the same YAML block: this document's frontmatter does not carry what a
 * file in its position must (SERVER-123). What the waiver never covered, and
 * used to drop anyway, is a Corpus field the file *did* write down and got
 * wrong; that is judged under those roots exactly as it is under `data/`
 * (SERVER-124, {@link waivedAsAbsent}).
 *
 * An anchor entry with no thread is deliberately on the failure side: §11 lists
 * "every anchor belongs to an existing thread" among the rules a mutation must
 * satisfy, and §6 states the invariant it protects — deleting or resolving a
 * thread removes its anchor entry, so "no highlight is ever left pointing at an
 * empty conversation". A dangling highlight is structural drift, not an
 * evolving-corpus state.
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
  anchorUnused: "anchor-unused",
  duplicateTurnTimestamp: "duplicate-turn-timestamp",
  unterminatedFence: "unterminated-fence",
  anchorUnresolved: "anchor-unresolved",
  refUnresolved: "ref-unresolved",
  residentMalformed: "resident-malformed",
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
  /**
   * Whether an id the passed document set does *not* contain nonetheless names
   * a real document. `corpus doc check` hands the checker the whole workspace
   * and needs none of this; a **save** hands it exactly one file, and without
   * this seam every `[[ref]]` in that file would be reported unresolved purely
   * because its target was not in the set. Injected rather than imported for
   * the same reason as {@link AnchorResolver}: the checker stays free of the
   * projection.
   */
  readonly documentExists?: (id: string) => boolean;
  /**
   * The ids of threads in the **live corpus** that claim `<docId>#<anchorId>`.
   *
   * `anchor-unused` is a cross-document rule — "is any thread pointing at this
   * anchor?" — and the passed set is only the whole answer when the whole
   * workspace was passed. Handed a subset (`corpus doc check <id>`, and every
   * `--staged` run, which is a subset by construction), the checker would
   * otherwise accuse the most ordinary document in the product — one that has
   * been commented on — of a dangling highlight, at *error* severity. This seam
   * is the `documentExists` of anchor claims: the same union, for the same
   * reason.
   *
   * It returns **ids** rather than a boolean so the union stays honest in the
   * other direction. The submitted set is authoritative for the documents it
   * contains: if a thread was passed to this checker, its submitted bytes say
   * whether it still claims the anchor, and a stale row in the caller's index
   * must not overrule them. So a live claimant that is itself in the set
   * contributes nothing, and only a claimant *outside* the set — a thread the
   * caller never mentioned — proves the anchor used. That is what lets a
   * `--staged` check still catch an anchor the staged edit genuinely orphaned
   * while accepting one whose thread simply was not staged.
   *
   * Consulted only for anchors that are about to be reported — an anchor claimed
   * by a submitted thread never reaches it.
   */
  readonly anchorClaimants?: (docId: string, anchorId: string) => readonly string[];
  /**
   * Whether a path sits under one of §7's **Claude Code roots** — `.claude/…` —
   * and, if Claude Code loads a subagent from it, the name it discovers the file
   * under (its filename, for `.claude/agents/<name>.md`).
   *
   * One seam because it answers one question with two halves, and the halves are
   * mirror images of each other (SERVER-123):
   *
   * - **Non-null waives §5's canonical block — its *presence*, not its
   *   *shape*.** Those roots legitimately hold files carrying Claude Code's
   *   frontmatter and not Corpus's — a hand-written `SKILL.md` has no `id:`,
   *   which is why the projection synthesizes one — so a Corpus field the file
   *   never wrote down raises nothing. A field it *did* write down is judged
   *   exactly as it is anywhere else; see {@link waivedAsAbsent}. Suppressed
   *   *here*, at the rule, rather than filtered out of the report by each
   *   consumer: a filter keyed on `code` + `path` cannot tell §5's finding from
   *   the one below, which carries the same code for the opposite reason.
   * - **A non-null `discoveredAs` requires Claude Code's block**, by the same
   *   §7 sentence: "`corpus doc check` validates both sets". A file there
   *   missing `name` or `description` is silently not loaded as a subagent, and
   *   a `name` that disagrees with the filename gives one file two addresses
   *   (Claude Code dispatches by the field, Corpus resolves `@<name>` by the
   *   path). See {@link claudeCodeFrontmatterIssues}.
   *
   * Absent, both halves are simply not applied: `checkCorpus` stays free of the
   * projection's root table, exactly as it stays free of the anchor engine.
   */
  readonly claudeCodeRoot?: (path: string) => ClaudeCodeRoot | null;
};

/** What a path under one of §7's Claude Code roots means for its frontmatter. */
export type ClaudeCodeRoot = {
  /**
   * The name Claude Code discovers the file under, or `null` when this root's
   * Claude Code fields are not judged — the file is under `.claude/`, so §5's
   * block is waived, but nothing is required in its place.
   */
  readonly discoveredAs: string | null;
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

/** One thing wrong with the Claude Code half of a file's frontmatter. */
export type ClaudeCodeFrontmatterIssue = {
  /** The frontmatter key at fault. */
  readonly field: "name" | "description";
  /** What is wrong and what it costs, rendered verbatim by every caller. */
  readonly message: string;
};

/**
 * §7's other half: "Corpus's frontmatter fields … coexist with Claude Code's
 * (`name`, `description`) in the same YAML block; `corpus doc check` validates
 * both sets" (SERVER-123).
 *
 * Claude Code loads a subagent from `.claude/agents/<name>.md` only when the
 * frontmatter carries **both** fields; with one, or with neither, it lists
 * nothing and warns about nothing. Measured against a real session, all four
 * combinations: only both-present loads. So a profile missing either is not a
 * document with a cosmetic gap — it is a persona Corpus will happily designate
 * and Claude Code cannot run.
 *
 * The third rule is the naming one, and it is the same silence from the other
 * side. §8 resolves a mention through the **path** (`invocableName`) — there is
 * no `name` column, and the path is what Claude Code discovers a file by too —
 * so `.claude/agents/bareprofile.md` carrying `name: numbers` is `numbers` to a
 * dispatch and `@bareprofile` to a mention. Measured in the drill: with no
 * Corpus `title:` the projection falls back to `name`, so Corpus answers to
 * *both* words and a reader cannot tell which one the file is; with a `title:`
 * of its own, `numbers` resolves to nothing at all. One file, two addresses,
 * either way, and nothing anywhere said so.
 *
 * Every message names the field **and what it costs**, because "field absent" is
 * not actionable and the cost is the whole point of the finding.
 *
 * Shared with `docs/create.ts` rather than restated there: the create route
 * refuses a profile this function would fault, so the rule the write enforces
 * and the rule the check reports are one function, not two that agree today.
 */
export function claudeCodeFrontmatterIssues(
  data: Record<string, unknown>,
  discoveredAs: string,
): ClaudeCodeFrontmatterIssue[] {
  const issues: ClaudeCodeFrontmatterIssue[] = [];
  const unloadable =
    "Claude Code loads a subagent only when its frontmatter carries both `name` and " +
    "`description`, so this profile is listed by nothing, dispatched to by nothing, and warned " +
    "about by nothing";

  const name = data["name"];
  if (name === discoveredAs) {
    // The one passing case: the field agrees with the filename.
  } else if (name === undefined || name === null || (typeof name === "string" && name === "")) {
    issues.push({
      field: "name",
      message:
        `missing — ${unloadable}; it must be \`${discoveredAs}\`, the filename Corpus resolves ` +
        `\`@${discoveredAs}\` by`,
    });
  } else {
    // A non-string `name` is quoted as the JSON it is: the field is reported
    // verbatim, and `[object Object]` would name nothing the author can find.
    const spelled = typeof name === "string" ? name : JSON.stringify(name);
    issues.push({
      field: "name",
      message:
        `\`${spelled}\` is not the filename \`${discoveredAs}\` — Claude Code dispatches to ` +
        `this subagent as \`${spelled}\` while Corpus resolves it as \`@${discoveredAs}\`, ` +
        "so one file answers to two addresses and neither reader knows about the other",
    });
  }

  const description = data["description"];
  if (typeof description !== "string" || description.trim() === "") {
    issues.push({
      field: "description",
      message:
        `missing or empty — ${unloadable}; it is also the only part of the file another agent ` +
        "reads when choosing whom to dispatch to, so it says *when to reach for this one*",
    });
  }

  return issues;
}

/**
 * Whether §5's waiver under a `.claude/` root covers this frontmatter issue —
 * i.e. whether the issue is about a field the file **did not write down**
 * (SERVER-124).
 *
 * The waiver has to drop *required-ness*: a hand-written profile legitimately
 * has no `id`, no `type`, no `status`, and demanding them would fail files
 * Claude Code wrote and Corpus only reads. It was never meant to drop
 * *well-formedness* of the fields that are there. `status: banana` has not
 * omitted a field, it has got one wrong — and §7:399 promises `corpus doc check`
 * validates Corpus's set. Before this split it validated none of it under these
 * roots: the whole block was unfalsifiable the moment somebody wrote one.
 *
 * The question is therefore "did the author write this key down?", asked of the
 * **raw mapping** rather than of the validated value (there is none — validation
 * failed) and of the *top-level* key, so a fault nested under `anchors` is a
 * fault in something present.
 *
 * **A key present with an explicit `null` counts as absent.** `key:` with
 * nothing after it is YAML's ordinary spelling of "not filled in" — a template
 * stub, a half-finished hand edit — and it carries exactly the information the
 * waiver exists to permit: there is no Corpus block here. It also cannot mislead
 * a reader the way a wrong value can, because every projection reader falls back
 * for `null` to precisely what it falls back to for a missing key
 * (`asString`, `TagsSchema.safeParse`, `DocStatusSchema.safeParse` in
 * `projection/project-document.ts` all do), so the two are indistinguishable
 * downstream and reporting one but not the other would be a finding about a
 * keystroke rather than about the document. The fields where `null` is a
 * *legal* value — `due`, `reviewed`, and a thread's `parent` and `anchor` —
 * never produce an issue at all, so this decision only ever touches keys for
 * which `null` and absent already mean the same thing.
 *
 * There is deliberately no case for `type`: `DocTypeSchema` is an open
 * `z.string().min(1)` (SPEC.md §5), so `type: not-a-real-type` is reported by
 * nothing, here or under `data/`. **That openness is a promise, not an
 * oversight** — a workspace may hold a type this build has never heard of,
 * written by hand or left behind by the workspace's own history, and §12's M6
 * requires such a document to open, render and search like any other. Closing
 * the enum would turn every one of them into a finding about a value the
 * document is entitled to carry. `type: []` and `type: ""` are reported, being
 * not a non-empty string.
 */
const waivedAsAbsent = (
  data: Readonly<Record<string, unknown>>,
  issue: FrontmatterIssue,
): boolean =>
  issue.field === null || !Object.hasOwn(data, issue.field) || data[issue.field] === null;

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
 * A fenced code block the body never closed (SERVER-066).
 *
 * **Why this is an error rather than a warning.** §11's warning family is the
 * two states it carves out by name, and both are normal outcomes of using the
 * system as designed — an anchor the author edited out from under a thread (§6),
 * a `[[ref]]` written before its target exists (§5). An unclosed fence is never
 * that. It is a mistake in the bytes, and in a thread it *destroys content*
 * silently: `turns.ts` excludes fenced regions when locating `## author · ts`
 * delimiters so a snippet can quote the turn format without faking a turn, so a
 * fence that runs to the end of the body makes every later turn heading
 * invisible and folds those turns into the one before them. That exclusion is
 * correct and stays; this finding is how the consequence stops being silent.
 *
 * **Why it is nonetheless not in `docs/write.ts`'s `LOCAL_CHECK_CODES`.** It is
 * decidable from one file, so it would otherwise qualify — but a blocking rule is
 * evaluated over the *whole body about to be written*, and an unclosed fence is
 * a property a document can already have. Blocking would therefore refuse every
 * subsequent write to such a thread, the user's reply and the agent's own
 * attempt to fix it included, making the document unwritable — strictly worse
 * than the swallow it would be trying to prevent. A save is refused for what a
 * save can *break*; this breaks nothing structural, and the document projects
 * normally. `anchor-unused` already has exactly this shape: an error a check
 * fails on and no save is refused for.
 *
 * **One code, not two.** A thread loses turns and an ordinary document merely
 * reads the rest of its body as code (losing its `[[refs]]` and headings with
 * it), but the defect and its fix are identical, and the wire partitions
 * severity *by code* — so a second code would exist only to carry a second
 * severity nobody would act on differently. The consequence is spelled out in
 * `detail` instead, which is what the CLI renders verbatim.
 */
const checkUnterminatedFence = (
  parsed: ParsedDocument,
  path: string,
  docId: string | null,
  isThread: boolean,
  report: ReturnType<typeof findings>,
): void => {
  const open = unterminatedFence(parsed.body);
  if (open === null) return;
  // The run is described by count rather than quoted verbatim: a backtick run
  // inside backticks is the very ambiguity being reported, and `detail` is
  // rendered as-is by `corpus doc check`.
  const runName = open.marker.startsWith("`") ? "backticks" : "tildes";
  const turnConsequence = isThread
    ? " — and every `## author · timestamp` turn heading after it is invisible, so those turns are lost"
    : "";
  report.error(
    CHECK_CODES.unterminatedFence,
    docId,
    path,
    `unterminated fenced code block opened at line ${bodyStartLine(parsed) + open.line - 1} ` +
      `with a run of ${open.marker.length} ${runName}: it closes only on a line holding nothing ` +
      `but ${open.marker.length} or more ${runName}, so everything after it reads as ` +
      `code${turnConsequence}`,
  );
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
  // Every `<parent>#<anchor>` pair any thread *writes down*, validated or not,
  // for the same anti-cascade reason: a thread with one bad field still claims
  // its anchor, so the parent must not additionally be accused of leaving that
  // anchor dangling. `anchorClaims` below is the stricter, validated set and is
  // what the duplicate-claim and missing-anchor rules judge against.
  const declaredClaims = new Set<string>();

  for (const entry of documents) {
    if (!entry.ok) {
      report.error(CHECK_CODES.frontmatterUnparseable, null, entry.path, entry.error);
      continue;
    }
    const rawId = entry.document.data["id"];
    const docId = typeof rawId === "string" ? rawId : null;
    if (docId !== null) knownIds.add(docId);

    if (isThreadFrontmatter(entry.document.data)) {
      const rawParent = entry.document.data["parent"];
      const rawAnchor = entry.document.data["anchor"];
      if (typeof rawParent === "string" && typeof rawAnchor === "string")
        declaredClaims.add(`${rawParent}#${rawAnchor}`);
    }

    // Anchor entries are checked against the raw mapping first: schema
    // validation would reject the whole document for one bad selector, and the
    // specific rule is what a §11 report is for.
    checkAnchorEntries(entry.document, entry.path, docId, report);

    // Before the validation gate below, and asked of every document type: a body
    // is markdown whatever the frontmatter says about it, and a document with one
    // bad field must not hide a fence that is eating the rest of its content.
    checkUnterminatedFence(
      entry.document,
      entry.path,
      docId,
      isThreadFrontmatter(entry.document.data),
      report,
    );

    // §7's Claude Code roots, both halves (see `CheckOptions.claudeCodeRoot`).
    // Asked before the validation gate below, and of the raw mapping, because
    // the files this judges most often carry *no* Corpus frontmatter at all —
    // a hand-written profile is `name` + `description` and nothing else, and it
    // would never reach a rule that ran after validation succeeded.
    const claudeCodeRoot = options.claudeCodeRoot?.(entry.path) ?? null;
    const discoveredAs = claudeCodeRoot?.discoveredAs ?? null;
    if (discoveredAs !== null) {
      for (const issue of claudeCodeFrontmatterIssues(entry.document.data, discoveredAs)) {
        report.error(
          CHECK_CODES.frontmatterInvalid,
          docId,
          entry.path,
          `${issue.field}: ${issue.message}`,
        );
      }
    }

    const validated = validateFrontmatter(entry.document.data);
    if (!validated.ok) {
      // §5's canonical block is waived under those same roots — a file there
      // legitimately carries Claude Code's fields and not Corpus's, which is why
      // the projection synthesizes an id for it. The waiver is over *presence*
      // alone: a field the file actually wrote down is judged here as it is
      // anywhere else, because omitting a field and getting one wrong are two
      // different things and only the first is what these roots excuse
      // (SERVER-124 — see {@link waivedAsAbsent}). Every *structural* rule above
      // still ran; the document is still not loaded into the cross-document
      // passes either way, because its frontmatter did not validate and there is
      // nothing trustworthy to judge it by.
      for (const issue of validated.issues) {
        if (claudeCodeRoot !== null && waivedAsAbsent(entry.document.data, issue)) continue;
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

  const existsInCorpus = (id: string): boolean =>
    knownIds.has(id) || (options.documentExists?.(id) ?? false);

  /**
   * Whether a thread the submitted set does not contain claims this anchor. A
   * claimant that *is* in the set has already spoken through `declaredClaims`
   * (or has deliberately stopped claiming the anchor, which is exactly the drift
   * a staged check exists to catch), so its row is ignored.
   */
  const claimedOutsideCorpus = (docId: string, anchorId: string): boolean =>
    (options.anchorClaimants?.(docId, anchorId) ?? []).some((threadId) => !knownIds.has(threadId));

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

    // An ill-shaped `resident:` block, on the thread §7 allows one on
    // (CONTRACT-085). SERVER-132 made this visible through `corpus db doctor` —
    // a health command somebody runs deliberately — and not through the check
    // somebody runs on a document they are editing, because reporting it needed
    // a code and the enum is closed. It has one now.
    //
    // **A warning, and the severity is the whole decision.** A designation is
    // user-only state on a thread the user owns; every non-warning code blocks
    // the write, so reporting this as an error would make the broken thread
    // permanently unwritable — SERVER-123's regression verbatim, and the reason
    // this was not simply filed under `frontmatter-invalid`. The fault is
    // already in the bytes, and a save is refused for what a save can break.
    const residentFault =
      thread.parent === null ? residentProblem(document.parsed.data["resident"]) : null;
    if (residentFault !== null) {
      report.warn(CHECK_CODES.residentMalformed, thread.id, document.path, residentFault);
    }

    const parent = thread.parent === null ? null : byId.get(thread.parent);
    if (thread.parent !== null && !existsInCorpus(thread.parent)) {
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
      if (
        !declaredClaims.has(`${document.frontmatter.id}#${anchorId}`) &&
        !claimedOutsideCorpus(document.frontmatter.id, anchorId)
      ) {
        report.error(
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
      if (!existsInCorpus(id)) {
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
