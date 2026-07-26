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
});

/**
 * Thread documents add the §6 fields. `agent` defaults to `none` rather than
 * failing: a hand-written thread that never asked for the agent is a legitimate
 * document, and §8 makes `none` exactly that state.
 */
export const FileThreadFrontmatterSchema = FileFrontmatterSchema.extend({
  id: ThreadIdSchema,
  type: z.literal("thread"),
  parent: DocumentIdSchema.nullable().default(null),
  anchor: AnchorIdSchema.nullable().default(null),
  agent: ThreadAgentSchema.default("none"),
});

export type FileFrontmatter = z.infer<typeof FileFrontmatterSchema>;
export type FileThreadFrontmatter = z.infer<typeof FileThreadFrontmatterSchema>;

export type FrontmatterIssue = { readonly path: string; readonly message: string };

export type FrontmatterResult =
  | { readonly ok: true; readonly value: FileFrontmatter; readonly thread: boolean }
  | { readonly ok: false; readonly issues: readonly FrontmatterIssue[] };

const toIssues = (error: z.ZodError): FrontmatterIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "<root>" : issue.path.join("."),
    message: issue.message,
  }));

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
