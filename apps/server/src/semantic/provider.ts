/**
 * The embedding seam (SPEC.md §9.1): one narrow interface every source of
 * vectors implements — the in-process embedded engine (SERVER-048) and any
 * provider an operator declares in `.corpus/config.json`.
 *
 * It is deliberately two members wide. A provider embeds a batch of strings and
 * says what it is; everything else — batching policy, retries, backoff, storage
 * — belongs to the worker that drives it (SERVER-044), because a seam that
 * knows about retries is a seam every implementation has to re-decide.
 *
 * **The dimension is discovered, never declared.** `identity` is `null` until
 * the first successful batch comes back, and is then fixed forever from the
 * length of the vectors that batch returned. A model's dimension is a fact about
 * the response; a table of dimensions keyed by model name is a second source of
 * truth that is wrong the first time a model is re-released under its old name.
 */

import { CorpusError } from "../errors.js";
import { formatIdentity, type EmbeddingModelRef } from "./identity.js";

/** A provider that could not produce vectors. Never carries key material — see {@link redactSecrets}. */
export class EmbeddingError extends CorpusError {
  override readonly name = "EmbeddingError";
}

export interface EmbeddingProvider {
  readonly ref: EmbeddingModelRef;
  /**
   * `provider/model@dim`, or `null` before the first successful batch: the
   * dimension is not known until a response carries it.
   */
  readonly identity: string | null;
  /**
   * Vectors in the order of `texts`, one per input. Rejects with
   * {@link EmbeddingError} for anything the caller could not have prevented —
   * an unreachable endpoint, a refused model, a malformed response.
   */
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>;
}

/**
 * Credentials written into a URL's authority: `scheme://user:pass@host`.
 *
 * Matched on the wire syntax rather than by parsing, because the strings this
 * runs over are *prose* — an error message, a quoted response body — and a URL
 * inside one is not a URL the caller holds a parsed copy of. The password half
 * is optional: `https://token@host` is the shape a bearer-in-the-URL takes.
 */
const URL_USERINFO = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/?#\s@]+@/g;

/**
 * Replaces every occurrence of each secret with `***`, and every set of
 * credentials embedded in a URL's authority with `***@`.
 *
 * Applied to every string that can reach a log or an error message on a path
 * that has seen an API key. Keys arrive from `.corpus/config.json` and end up in
 * request headers; an upstream that echoes a header back inside an error body,
 * or a `fetch` failure quoting a URL an operator embedded credentials in, is
 * exactly how a key reaches a log file nobody expected it in. Empty secrets are
 * ignored — replacing `""` would rewrite the whole string.
 *
 * The URL half is not covered by the secret list: `https://user:pass@host` is a
 * credential the operator wrote into `endpoint`, never into `apiKey`, so nothing
 * in `secrets` matches it — and the endpoint is quoted verbatim in every error
 * this module raises. Redacting the whole userinfo (not just the password)
 * matches how every other tool prints a URL, and keeps a username that *is* the
 * token from surviving.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text.replace(URL_USERINFO, "$1***@");
  for (const secret of secrets) {
    if (secret === undefined || secret === "") continue;
    out = out.split(secret).join("***");
  }
  return out;
}

/** Embeds one batch and returns raw numbers — the only thing an implementation writes. */
export type EmbedBatchFn = (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;

/**
 * Wraps a raw batch function into a provider, applying the rules every
 * implementation would otherwise re-derive: an empty batch costs nothing, the
 * response is checked against the request, and the dimension is taken from the
 * first response and then enforced.
 *
 * The enforcement is not paranoia about the seam's own callers: a configured
 * endpoint that silently starts serving a different model behind the same name
 * would otherwise write vectors that cannot be compared with the ones already
 * stored, under an identity claiming they can.
 */
export function createEmbeddingProvider(
  ref: EmbeddingModelRef,
  embedBatch: EmbedBatchFn,
): EmbeddingProvider {
  let dim: number | undefined;

  return {
    ref,
    get identity() {
      return dim === undefined ? null : formatIdentity(ref, dim);
    },
    async embed(texts) {
      if (texts.length === 0) return [];

      const raw = await embedBatch(texts);
      if (raw.length !== texts.length) {
        throw new EmbeddingError(
          `embedding provider ${ref.provider}/${ref.model} returned ${raw.length} vectors for ${texts.length} inputs`,
        );
      }

      const vectors: Float32Array[] = [];
      for (const vector of raw) {
        if (vector.length === 0) {
          throw new EmbeddingError(
            `embedding provider ${ref.provider}/${ref.model} returned an empty vector`,
          );
        }
        dim ??= vector.length;
        if (vector.length !== dim) {
          throw new EmbeddingError(
            `embedding provider ${ref.provider}/${ref.model} returned ${vector.length}-dimensional ` +
              `vectors after reporting ${dim}; the model behind it changed`,
          );
        }
        if (!vector.every((value) => Number.isFinite(value))) {
          throw new EmbeddingError(
            `embedding provider ${ref.provider}/${ref.model} returned a non-finite vector component`,
          );
        }
        vectors.push(Float32Array.from(vector));
      }
      return vectors;
    },
  };
}
