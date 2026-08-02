/**
 * The one string that decides whether a stored vector may be compared with a
 * freshly computed one (SPEC.md §9.1, "one index, one model").
 *
 * The format is `provider/model@dim`, and it is written here and nowhere else.
 * CONTRACT-023 pins the wire side as a single nullable string that clients
 * "render verbatim and compare for equality, never parse" — so the *format* is
 * the server's, and the only thing anyone may do with the value is compare it.
 *
 * This module deliberately offers **no parser**. Stickiness needs to ask "was
 * this identity produced by that provider and model?", which is answered by
 * building the prefix and comparing (`identityNamesModel`), never by splitting a
 * string whose model half may legitimately contain `/`, `:` or `@`. The
 * dimension is never in a table here either: it is read from the provider's
 * first response (`provider.ts`), because a table of model dimensions is a
 * second source of truth that goes stale the day a model is re-released.
 */

/** The two halves of an identity a provider knows before it has embedded anything. */
export interface EmbeddingModelRef {
  /** The provider token: `local` for the embedded engine, `ollama`/`openai` for configured ones. */
  readonly provider: string;
  readonly model: string;
}

/** `provider/model@` — everything an identity carries except the dimension. */
export function identityPrefix(ref: EmbeddingModelRef): string {
  return `${ref.provider}/${ref.model}@`;
}

/** The full identity, with the dimension the provider's own response reported. */
export function formatIdentity(ref: EmbeddingModelRef, dim: number): string {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new RangeError(`embedding dimension must be a positive integer, got ${String(dim)}`);
  }
  return `${identityPrefix(ref)}${dim}`;
}

/**
 * Whether `identity` was produced by this provider and model — the question
 * stickiness asks when it decides whether the engine available now is the one
 * that built the index. Prefix comparison, not parsing: a model named
 * `hf.co/user/repo:q8` round-trips, and nothing here has to know that.
 */
export function identityNamesModel(identity: string, ref: EmbeddingModelRef): boolean {
  return identity.startsWith(identityPrefix(ref));
}

/**
 * What the recorded index says about the provider resolved for this run.
 *
 * SERVER-043 only *reports* this. Acting on it — queueing a full rebuild on
 * `mismatch`, failing `db doctor` on `mixed` — belongs to SERVER-044 and
 * SERVER-046, which is why this is a pure function with a return value and no
 * database writes anywhere near it.
 */
export type IndexIdentityCheck =
  /** Nothing has been embedded yet: whatever resolves now becomes the identity. */
  | { readonly kind: "no-index" }
  /** The index and the resolved provider agree; nothing to do. */
  | { readonly kind: "match"; readonly identity: string }
  /** The effective model changed: the index is invalid and must be rebuilt (SERVER-044). */
  | { readonly kind: "mismatch"; readonly recorded: string; readonly resolved: string }
  /** Vectors from two models in one index — drift, never staleness (SERVER-046's doctor). */
  | { readonly kind: "mixed"; readonly identities: readonly string[] }
  /** An index exists but nothing can embed right now; the vectors stay valid and untouched. */
  | { readonly kind: "unresolved"; readonly recorded: string };

/**
 * `recorded` is every distinct identity in `chunk_embeddings`, and `resolved` is
 * the identity of the provider this run resolved (`null` when none did).
 *
 * `mixed` outranks `mismatch`: an index holding two identities is broken in a
 * way a rebuild-on-mismatch would paper over, and §9.1 calls that drift.
 */
export function checkIndexIdentity(
  recorded: readonly string[],
  resolved: string | null,
): IndexIdentityCheck {
  if (recorded.length > 1) return { kind: "mixed", identities: [...recorded] };

  const only = recorded[0];
  if (only === undefined) return { kind: "no-index" };
  if (resolved === null) return { kind: "unresolved", recorded: only };
  if (resolved === only) return { kind: "match", identity: only };
  return { kind: "mismatch", recorded: only, resolved };
}
