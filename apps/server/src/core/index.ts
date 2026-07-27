/**
 * `core` — the document model: the single place in Corpus where the on-disk
 * formats are parsed, validated and serialized (SPEC.md §5, §6, §14).
 *
 * Every write path, the projection and the validation surface build on this
 * library; nothing outside `core/` re-implements a parser, and nothing outside
 * `core/` imports its internal modules directly — this file is the surface.
 *
 * The library is I/O-free by design. It takes and returns strings; callers own
 * the filesystem, git and the database.
 */

export * from "./anchor-entries.js";
export * from "./check.js";
export * from "./code.js";
export * from "./document.js";
export * from "./frontmatter.js";
export * from "./ids.js";
export * from "./paths.js";
export * from "./refs.js";
export * from "./time.js";
export * from "./turns.js";
