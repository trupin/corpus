/**
 * Which provider, if any, produces this workspace's vectors — SPEC.md §9.1's
 * local-first rule, as a function.
 *
 * The order is fixed and short:
 *
 * 1. **An explicitly configured provider wins.** It is the only leg that dials
 *    anything, and it is the only leg that fails *loudly*: an operator who named
 *    an endpoint is owed an error when it does not answer, not a quiet
 *    substitution. Falling back here would mean an index silently built by a
 *    model nobody chose.
 * 2. **The embedded engine, when it reports itself available** (SERVER-048): an
 *    in-process library over a model artifact in a per-user cache. Nothing is
 *    probed and nothing is installed — the engine answers a capability question
 *    about its own cache.
 * 3. **`disabled`** — a first-class state, not an error. Search stays lexical
 *    and says so (CONTRACT-023's `state: "disabled"`). A workspace with no
 *    configuration on a machine with no downloaded model is *working*, and the
 *    reason is carried so `corpus index status` can say which flavour of nothing
 *    it is.
 *
 * **Stickiness** (§9.1, "one index, one model") is enforced here rather than by
 * the worker: when the index already holds vectors, an embedded engine is only
 * adopted if it is the one that produced them. A different model appearing on
 * the machine changes nothing — the effective model moves only through an
 * explicit act, which is an edit to `.corpus/config.json` (leg 1 always wins) or
 * `corpus index rebuild` (which discards the vectors, leaving nothing to be
 * sticky about). "Never as a surprise background rebuild" is that sentence.
 */

import { createConfiguredProvider, type FetchLike } from "./http-provider.js";
import { identityNamesModel } from "./identity.js";
import type { EmbeddedEngine, EmbeddedEngineUnavailableReason } from "./embedded-engine.js";
import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingSettings } from "./settings.js";

/**
 * The batch resolution embeds to learn the dimension. One short word, because
 * some providers bill by token and every boot pays for this exactly once.
 */
export const PROBE_TEXT = "corpus";

export type ProviderSource = "config" | "embedded";

/**
 * Why no provider resolved. The three engine reasons are the engine's own,
 * carried through unchanged so the honest distinction survives to the status
 * surface: "nothing is configured and this build has no engine" is a different
 * sentence from "the engine is here and its model has not been downloaded yet".
 */
export type DisabledReason =
  | EmbeddedEngineUnavailableReason
  /** `"provider": "none"` — an operator turned semantic indexing off. */
  | "off-by-config"
  /** An index exists, and the engine available now is not the one that built it. */
  | "sticky-model-unavailable";

export type ResolutionErrorReason =
  /** The `embedding` block names something this build cannot serve (already warned at boot). */
  | "invalid-config"
  /** A configured endpoint refused, timed out, or answered with something that was not vectors. */
  | "provider-unreachable"
  /** The engine said it was available and then failed to load or embed. */
  | "engine-failed";

export type ProviderResolution =
  | {
      readonly kind: "provider";
      readonly source: ProviderSource;
      readonly provider: EmbeddingProvider;
      /** Known here, because resolution embeds a probe: the dimension is the response's. */
      readonly identity: string;
      /** True when this provider was kept because the index already holds its vectors. */
      readonly sticky: boolean;
    }
  | { readonly kind: "disabled"; readonly reason: DisabledReason; readonly detail: string }
  | { readonly kind: "error"; readonly reason: ResolutionErrorReason; readonly detail: string };

export interface ResolveProviderOptions {
  readonly settings: EmbeddingSettings;
  /** `undefined` until SERVER-048 registers one — the state this build ships in. */
  readonly embeddedEngine?: EmbeddedEngine | undefined;
  /** Every distinct identity already in `chunk_embeddings` (`embeddings.ts`). */
  readonly recordedIdentities?: readonly string[] | undefined;
  readonly fetchFn?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Embeds the probe and reads the dimension off the answer. A provider whose
 * `identity` is still `null` afterwards returned nothing usable, which is a
 * failure of the same class as an unreachable endpoint.
 */
async function probe(provider: EmbeddingProvider): Promise<string> {
  await provider.embed([PROBE_TEXT]);
  const identity = provider.identity;
  if (identity === null) {
    throw new Error(`${provider.ref.provider}/${provider.ref.model} returned no vector to size`);
  }
  return identity;
}

/**
 * The one identity the index is built on, or `null` when there is none — or when
 * there is more than one, which is drift for `db doctor` to fail on (SERVER-046)
 * and no basis for steering anything.
 */
function stickyIdentity(recorded: readonly string[] | undefined): string | null {
  if (recorded === undefined || recorded.length !== 1) return null;
  return recorded[0] ?? null;
}

async function resolveEmbedded(
  engine: EmbeddedEngine | undefined,
  options: ResolveProviderOptions,
): Promise<ProviderResolution> {
  if (engine === undefined) {
    return {
      kind: "disabled",
      reason: "engine-not-installed",
      detail:
        "no embedding provider is configured and this build has no embedded engine; " +
        "search is lexical only",
    };
  }

  let availability;
  try {
    availability = await engine.availability();
  } catch (error) {
    // An engine that cannot answer the capability question is not available.
    // It is also not a configured choice, so it stays quiet rather than loud.
    return {
      kind: "disabled",
      reason: "engine-not-installed",
      detail: `the embedded engine could not report its availability: ${messageOf(error)}`,
    };
  }

  if (!availability.available) {
    return { kind: "disabled", reason: availability.reason, detail: availability.detail };
  }

  const sticky = stickyIdentity(options.recordedIdentities);
  if (sticky !== null && !identityNamesModel(sticky, engine.ref)) {
    // §9.1: the effective model changes only through an explicit act. Adopting
    // the engine here would invalidate a perfectly good index because the
    // machine changed underneath it — precisely the surprise rebuild the spec
    // forbids. The vectors stay valid and searchable; `corpus index rebuild` is
    // the verb that re-picks.
    return {
      kind: "disabled",
      reason: "sticky-model-unavailable",
      detail:
        `the index was built by ${sticky} and the embedded engine offers ` +
        `${engine.ref.provider}/${engine.ref.model}; keeping the recorded model — ` +
        "`corpus index rebuild` re-picks",
    };
  }

  try {
    const provider = await engine.open(
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    const identity = await probe(provider);
    return { kind: "provider", source: "embedded", provider, identity, sticky: sticky !== null };
  } catch (error) {
    return {
      kind: "error",
      reason: "engine-failed",
      detail: `the embedded engine reported itself available and then failed: ${messageOf(error)}`,
    };
  }
}

export async function resolveEmbeddingProvider(
  options: ResolveProviderOptions,
): Promise<ProviderResolution> {
  const { settings } = options;

  if (settings.kind === "invalid") {
    return { kind: "error", reason: "invalid-config", detail: settings.detail };
  }

  if (settings.kind === "off") {
    return {
      kind: "disabled",
      reason: "off-by-config",
      detail: 'semantic indexing is turned off by `"provider": "none"`; search is lexical only',
    };
  }

  if (settings.kind === "configured") {
    const provider = createConfiguredProvider(settings.provider, {
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    try {
      const identity = await probe(provider);
      const sticky = stickyIdentity(options.recordedIdentities);
      return {
        kind: "provider",
        source: "config",
        provider,
        identity,
        sticky: sticky === identity,
      };
    } catch (error) {
      // No fall-through, by design: this is the one place where loud beats
      // graceful. A configured provider failing and a zero-config workspace
      // having nothing to configure are different events, and reporting the
      // first as the second is how an operator ends up debugging a model they
      // never chose.
      return { kind: "error", reason: "provider-unreachable", detail: messageOf(error) };
    }
  }

  return resolveEmbedded(options.embeddedEngine, options);
}

export interface ResolutionReport {
  readonly level: "info" | "error";
  readonly message: string;
}

/** The one line boot logs, and the sentence `corpus index status` can borrow. */
export function describeResolution(resolution: ProviderResolution): ResolutionReport {
  if (resolution.kind === "provider") {
    return {
      level: "info",
      message: `semantic index: ${resolution.identity} (${resolution.source})`,
    };
  }
  if (resolution.kind === "disabled") {
    return { level: "info", message: `semantic index disabled: ${resolution.detail}` };
  }
  return { level: "error", message: `semantic index unavailable: ${resolution.detail}` };
}
