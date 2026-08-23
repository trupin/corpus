import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * The `data/docs/` folder tree (SPEC.md §9.2), behind folder pickers, folder
 * columns and filter chips. The hierarchy stays the primary organization — the
 * agent reorganizes by moving files — so the tree is read often and is cheap
 * enough to return whole rather than lazily per level.
 */
export interface FolderNode {
  /** Path relative to `data/docs/`; the empty string is the root itself. */
  readonly path: string;
  /** Last segment of `path`, for display. */
  readonly name: string;
  /** Documents filed directly in this folder. */
  readonly count: number;
  /** `count` plus every descendant folder's count. */
  readonly totalCount: number;
  readonly children: readonly FolderNode[];
}

/**
 * Typed explicitly because the schema is recursive: TypeScript cannot infer a
 * type that references itself, and the `get children()` form is how Zod 4
 * expresses the cycle without a `z.lazy` wrapper the OpenAPI emitter would have
 * to unwrap.
 */
export const FolderNodeSchema: z.ZodType<FolderNode> = openapi(
  z.object({
    path: z.string().describe("Path relative to `data/docs/`; empty for the root."),
    name: z.string(),
    count: z.number().int().min(0).describe("Documents filed directly in this folder."),
    totalCount: z.number().int().min(0).describe("`count` plus every descendant folder's count."),
    get children() {
      return z.array(FolderNodeSchema);
    },
  }),
  "FolderNode",
);

export const FolderTreeSchema = openapi(
  z.object({
    folders: z.array(FolderNodeSchema).describe("Top-level folders under `data/docs/`."),
  }),
  "FolderTree",
);

export type FolderTree = z.infer<typeof FolderTreeSchema>;
