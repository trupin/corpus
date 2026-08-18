import {
  AnchorIdSchema,
  DocStatusSchema,
  DocTypeSchema,
  DocumentIdSchema,
  TextQuoteSelectorSchema,
  ThreadAgentSchema,
  ThreadIdSchema,
} from "@corpus/contract";
import { z } from "zod";
import type { ParsedDocument } from "./document.js";
import { normalizeCalendarDate, normalizeInstant } from "./time.js";
import { FileTurnModelsSchema } from "./turn-model.js";
import { originOrNull } from "./provenance.js";
import { residentOrNull } from "./resident.js";

/**
 * The **file-level** frontmatter shape (SPEC.md §5, §6) — deliberately not the
 * same schema as the wire shape.
 *
 * `@corpus/contract` owns the post-defaults form every core field is required
 * in; a file legitimately omits optional fields, so this is the *pre-defaults*
 * form plus passthrough for plugin keys. Everything the two do share — id
 * patterns, the selector shape, the status and agent enums — is imported, never
 * restated: two definitions of one shape is the drift Architecture Decision 3
 * exists to prevent.
 *
 * Applying a default here is an in-memory act only. Serialization re-emits the
 * file's own source (see `document.ts`), so reading a document that omits
 * `tags` never writes `tags: []` back to disk.
 */

/**
 * Hand-written files carry non-UTC offsets and millisecond precision; both are
 * accepted on read and normalized to canonical UTC-second form for in-memory
 * use, so the value handed on always satisfies the contract's `IsoDateTime`.
 */
const INSTANT_MESSAGE = "Expected an ISO-8601 UTC instant";
const DATE_MESSAGE = "Expected an ISO-8601 calendar date";

/** YAML 1.2's core schema keeps timestamps as strings; a `Date` only reaches us from a 1.1 writer. */
const asText = (value: string | Date): string | null =>
  typeof value === "string" ? value : Number.isNaN(value.getTime()) ? null : value.toISOString();

const FileInstantSchema = z
  .union([z.string(), z.date()], { error: INSTANT_MESSAGE })
  .transform((value, ctx) => {
    const text = asText(value);
    const normalized = text === null ? null : normalizeInstant(text);
    if (normalized === null) {
      ctx.issues.push({ code: "custom", input: value, message: INSTANT_MESSAGE });
      return z.NEVER;
    }
    return normalized;
  });

const FileCalendarDateSchema = z
  .union([z.string(), z.date()], { error: DATE_MESSAGE })
  .transform((value, ctx) => {
    const text = asText(value);
    const normalized =
      text === null
        ? null
        : typeof value === "string"
          ? normalizeCalendarDate(text)
          : text.slice(0, 10);
    if (normalized === null) {
      ctx.issues.push({ code: "custom", input: value, message: DATE_MESSAGE });
      return z.NEVER;
    }
    return normalized;
  });

/** Core fields every document carries, whatever its type. */
export const FileFrontmatterSchema = z.looseObject({
  id: DocumentIdSchema,
  type: DocTypeSchema,
  title: z.string(),
  created: FileInstantSchema,
  updated: FileInstantSchema,
  tags: z.array(z.string()).default([]),
  status: DocStatusSchema.default("open"),
  anchors: z.record(AnchorIdSchema, TextQuoteSelectorSchema).default({}),
  due: FileCalendarDateSchema.nullable().default(null),
  reviewed: FileInstantSchema.nullable().default(null),
  evergreen: z.boolean().default(false),
  /**
   * The conversation this document came from (SPEC.md §7 scope, §9.2
   * provenance, SHARED-043). **Defaults to `null` rather than being optional**,
   * for the reason every other core key here defaults: a document written
   * before provenance existed, or by a write that named no job, has no origin —
   * which is a fact about it, not a missing field — and the wire shape carries
   * `origin` on every document so a reader never has to tell "unfiled" from
   * "this server is too old to say".
   *
   * Nothing here *sets* it. The stamp is the write path's (SERVER-110), which
   * resolves the job a write names to the thread that event's payload names; this is only the
   * parse, and its whole job is to make the absent case explicit.
   *
   * **Anything that is not a thread id reads as `null` rather than failing.**
   * `origin` was a perfectly legal `extra` key before this existed — §5 and §12
   * make frontmatter the plugin extension point — so a workspace may already
   * hold documents whose `origin:` means something else entirely. Validating it
   * strictly would make every save of such a document a `400`, including the
   * reader's autosave, until somebody hand-edited the file: a corpus that
   * existed before a field did must not become unwritable because of it. The
   * value is dropped rather than preserved because the **wire** promises a
   * thread id or null, and `extra` cannot hold it either now that the key is
   * reserved — so this is the one place the old value goes, and it goes
   * quietly. (PR #47 review.)
   */
  origin: z
    .unknown()
    .transform((value) => originOrNull(value))
    .default(null),
});

/**
 * Thread documents add the §6 fields. `agent` defaults to `none` rather than
 * failing: a hand-written thread that never asked for the agent is a legitimate
 * document, and §8 makes `none` exactly that state.
 *
 * `turnModels` (SPEC.md §6, CONTRACT-043) defaults to the empty map for the same
 * reason every optional field here does: a thread nobody recorded a model for
 * simply has no key, which is §11's "nothing rather than a guess" spelled in
 * frontmatter. Its shape is `core/turn-model.ts`'s file-level form — the
 * contract's canonical map behind the one normalisation a file needs — so a
 * hand-written offset instant is accepted and an entry naming no instant at all
 * is reported as the §14 finding it is, rather than silently missing every turn.
 */
export const FileThreadFrontmatterSchema = FileFrontmatterSchema.extend({
  id: ThreadIdSchema,
  type: z.literal("thread"),
  parent: DocumentIdSchema.nullable().default(null),
  anchor: AnchorIdSchema.nullable().default(null),
  agent: ThreadAgentSchema.default("none"),
  turnModels: FileTurnModelsSchema.default({}),
  /**
   * The agent resident in this conversation (SPEC.md §7, SHARED-043,
   * SERVER-109), or `null` — which is what a thread nobody designated says, and
   * what dissolution leaves behind: §7 makes releasing the *absence* of a
   * resident and never a third state, so the release removes the key rather
   * than writing `resident: null`.
   *
   * Read through `resident.ts`'s one reader, and **leniently, for the reason
   * `origin` above is**: anything that is not `{name, docId}` reads as no
   * resident instead of failing the document, so a workspace that used the key
   * for something of its own stays readable and writable.
   */
  resident: z
    .unknown()
    .transform((value) => residentOrNull(value))
    .default(null),
});

export type FileFrontmatter = z.infer<typeof FileFrontmatterSchema>;
export type FileThreadFrontmatter = z.infer<typeof FileThreadFrontmatterSchema>;

export type FrontmatterIssue = {
  /** The dotted path rendered to the operator; `<root>` when the whole mapping is at fault. */
  readonly path: string;
  /**
   * The **top-level frontmatter key** the issue is about, or `null` when it is
   * about the mapping itself.
   *
   * Carried alongside {@link FrontmatterIssue.path} rather than recovered from
   * it by splitting on `.`, because the two answer different questions and only
   * this one is decidable: `path` is display text with a sentinel spelling for
   * the empty case, and a caller re-deriving the key from it would be parsing a
   * string whose grammar exists for a human. §5's waiver under `.claude/` turns
   * on exactly this key — "did the author write this field down?" — so it is
   * read off zod's own structured path, at the one place that has it
   * (SERVER-124).
   */
  readonly field: string | null;
  readonly message: string;
};

export type FrontmatterResult =
  | { readonly ok: true; readonly value: FileFrontmatter; readonly thread: boolean }
  | { readonly ok: false; readonly issues: readonly FrontmatterIssue[] };

const toIssues = (error: z.ZodError): FrontmatterIssue[] =>
  error.issues.map((issue) => {
    // A zod path element is a string, an array index, or a symbol. Only a string
    // at position 0 names a frontmatter key; anything else means the fault is
    // the mapping itself, which no key can be said to be present for.
    const head = issue.path[0];
    return {
      path: issue.path.length === 0 ? "<root>" : issue.path.join("."),
      field: typeof head === "string" ? head : null,
      message: issue.message,
    };
  });

/** True when this mapping declares itself a thread and must satisfy the §6 fields. */
export const isThreadFrontmatter = (data: Readonly<Record<string, unknown>>): boolean =>
  data["type"] === "thread";

/**
 * Validate a frontmatter mapping, picking the thread schema when the document
 * declares `type: thread`. Returns issues rather than throwing — the corpus
 * checker reports every document's problems, so one bad file must not abort the
 * run (§14).
 */
export const validateFrontmatter = (data: Readonly<Record<string, unknown>>): FrontmatterResult => {
  const schema = isThreadFrontmatter(data) ? FileThreadFrontmatterSchema : FileFrontmatterSchema;
  const result = schema.safeParse(data);
  if (!result.success) return { ok: false, issues: toIssues(result.error) };
  return { ok: true, value: result.data, thread: isThreadFrontmatter(data) };
};

/** Convenience over {@link validateFrontmatter} for an already-parsed document. */
export const documentFrontmatter = (parsed: ParsedDocument): FrontmatterResult =>
  validateFrontmatter(parsed.data);

/** Read a thread document's §6 fields; `null` when the document is not a valid thread. */
export const threadFrontmatter = (
  data: Readonly<Record<string, unknown>>,
): FileThreadFrontmatter | null => {
  const result = FileThreadFrontmatterSchema.safeParse(data);
  return result.success ? result.data : null;
};
