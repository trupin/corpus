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

// The code-region scanner — which bytes of a body are code, and whether a fence
// was left open — moved to `@corpus/contract` (CONTRACT-044). A fence rule is a
// format rule, and the format has readers outside this application: the composer
// pre-checks the same refusal the write path makes, and `apps/ui` cannot import
// `apps/server`. `core` keeps naming it because `core` is this server's
// document-model surface, so no caller on this side has to know where the
// implementation went.
export {
  codeRanges,
  fencedCodeRanges,
  inlineCodeRanges,
  overlapsRange,
  splitLines,
  unterminatedFence,
  type Line,
  type OpenFence,
  type TextRange,
} from "@corpus/contract";

export * from "./anchor-entries.js";
export * from "./check.js";
export * from "./document.js";
export * from "./form.js";
export * from "./frontmatter.js";
export * from "./ids.js";
export * from "./paths.js";
export * from "./refs.js";
export * from "./time.js";
export * from "./turn-model.js";
export * from "./turns.js";
export * from "./view-frontmatter.js";
