import type { PluginManifest } from "@corpus/kit/plugin";
import { z } from "zod";

/**
 * Runtime validation of a discovered plugin manifest (PLUGINS-001).
 *
 * `import.meta.glob` gives the registry whatever the module exported — the
 * types in `@corpus/kit/plugin` only constrain authors who used them. A
 * manifest is untrusted input at this boundary (docs/TS_GUIDELINES.md —
 * Zod-at-boundaries): a malformed one must become a readable warning in the
 * console strip, never a crash inside the board.
 *
 * Validation never throws and never mutates: on success the **original**
 * manifest object is returned by reference, so component identities survive
 * (a parsed copy would re-mount every plugin component on every render).
 */

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly error: string };

/**
 * React components are functions at this seam. `React.memo`/`forwardRef`
 * wrappers are exotic objects and deliberately out of contract for v1 — a
 * plugin can wrap *inside* its component instead.
 */
const component = (field: string) =>
  z.custom<(props: never) => unknown>((value) => typeof value === "function", {
    message: `${field} must be a React component function`,
  });

const DocTypeSchema = z.object({
  type: z.string().min(1, "docTypes[].type must be a non-empty string"),
  ListItem: component("docTypes[].ListItem").optional(),
  View: component("docTypes[].View").optional(),
  DocPanel: component("docTypes[].DocPanel").optional(),
  validate: z
    .custom<(doc: never) => readonly string[]>((value) => typeof value === "function", {
      message: "docTypes[].validate must be a function",
    })
    .optional(),
  // PLUGINS-016: the derived-status declaration. A manifest carrying anything
  // but a function here is refused whole at discovery (plugin skipped, logged
  // warning) — a declaration a surface would call must be callable, and half
  // a manifest is worse than none.
  deriveStatus: z
    .custom<(doc: never) => unknown>((value) => typeof value === "function", {
      message: "docTypes[].deriveStatus must be a function",
    })
    .optional(),
});

const ColumnTypeSchema = z.object({
  type: z.string().min(1, "columns[].type must be a non-empty string"),
  label: z.string().min(1, "columns[].label must be a non-empty string"),
  icon: z.string().optional(),
  Component: component("columns[].Component"),
  defaultQuery: z.record(z.string(), z.string()).optional(),
});

const ManifestSchema = z
  .object({
    id: z.string().min(1, "id must be a non-empty string"),
    name: z.string().min(1, "name must be a non-empty string"),
    icon: z.string().optional(),
    order: z.number().optional(),
    docTypes: z.array(DocTypeSchema),
    columns: z.array(ColumnTypeSchema),
  })
  .superRefine((manifest, ctx) => {
    for (const [field, entries] of [
      ["docTypes", manifest.docTypes.map((entry) => entry.type)],
      ["columns", manifest.columns.map((entry) => entry.type)],
    ] as const) {
      const seen = new Set<string>();
      for (const type of entries) {
        if (seen.has(type)) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} declares the type "${type}" twice`,
          });
        }
        seen.add(type);
      }
    }
  });

/** One readable line per issue, each naming the offending field. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Validates one discovered manifest export. `{ok: false}` carries a message
 * naming every offending field; `{ok: true}` carries the input by reference.
 */
export function validateManifest(value: unknown): ManifestValidation {
  const result = ManifestSchema.safeParse(value);
  if (!result.success) return { ok: false, error: describeIssues(result.error) };
  return { ok: true, manifest: value as PluginManifest };
}
