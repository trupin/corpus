/**
 * The contract between this seam and the **embedded engine** — the in-process
 * embedding library whose model artifact is downloaded once into a per-user
 * cache (SERVER-048 implements it; user ruling of 2026-07-31, revising
 * sprint-021's Open Conflict 1).
 *
 * Two properties of that ruling shape this file:
 *
 * - **Nothing here probes anything.** The earlier design asked a local model
 *   *server* (Ollama on its conventional port) whether it was up. A daemon that
 *   can pull third-party models from the internet is unapprovable in the
 *   environments Corpus is meant to be installable in, and "is something
 *   listening on 11434?" is not a question a document tool should be asking. The
 *   resolution path now touches the network in exactly one place: a provider an
 *   operator explicitly configured, dialling the endpoint that operator named.
 * - **Availability is a capability the engine reports, not a state this module
 *   infers.** Whether the model artifact has been downloaded, whether the engine
 *   can run on this platform, and where the cache lives are all SERVER-048's to
 *   know. The seam asks one question and gets one closed-vocabulary answer, so
 *   `corpus index status` can be honest about *why* it is disabled without this
 *   module learning anything about ONNX files.
 *
 * Until SERVER-048 lands, no engine is registered: `resolveEmbeddingProvider`
 * receives `undefined` and reports `engine-not-installed`. That is the seam
 * working, not a gap in it — the whole point of a resolution order whose last
 * leg is `disabled` is that the product is complete with nothing plugged in.
 */

import type { EmbeddingModelRef } from "./identity.js";
import { createEmbeddingProvider, type EmbedBatchFn, type EmbeddingProvider } from "./provider.js";

/** The provider token every embedded-engine identity carries: `local/<model>@<dim>`. */
export const EMBEDDED_PROVIDER = "local";

/**
 * Why an engine cannot serve right now. A closed set, because each value is a
 * sentence someone reads in `corpus index status` and the honest distinction the
 * user asked for — "no model downloaded yet" is not "nothing configured" — has
 * to survive the trip to the status surface intact.
 */
export const EMBEDDED_ENGINE_UNAVAILABLE_REASONS = [
  /** This build has no embedded engine at all (the state until SERVER-048). */
  "engine-not-installed",
  /** The engine is here; its model artifact has not been downloaded into the cache. */
  "model-not-downloaded",
  /** The engine is here and cannot run on this machine. */
  "unsupported-platform",
] as const;

export type EmbeddedEngineUnavailableReason = (typeof EMBEDDED_ENGINE_UNAVAILABLE_REASONS)[number];

export type EmbeddedEngineAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: EmbeddedEngineUnavailableReason;
      /** One clause, shown to a person: what is missing and what would fix it. */
      readonly detail: string;
    };

export interface EmbeddedEngineOpenOptions {
  /** Aborted when the server shuts down mid-load; an engine that ignores it merely delays exit. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The engine as the seam sees it. `ref` is known without loading anything — it
 * is what stickiness compares against a recorded identity before deciding
 * whether to load a model at all — while the dimension, as everywhere else,
 * comes from the first response.
 */
export interface EmbeddedEngine {
  readonly ref: EmbeddingModelRef;
  /** Never throws in a correct implementation; a rejection is treated as unavailable. */
  availability(): Promise<EmbeddedEngineAvailability>;
  /** Loads the model and returns a live provider. Called only after `availability()` said yes. */
  open(options?: EmbeddedEngineOpenOptions): Promise<EmbeddingProvider>;
}

export interface StaticEmbeddedEngineOptions {
  readonly model: string;
  /** Defaults to available; a fixed unavailable answer is the other half of the seam's tests. */
  readonly availability?: EmbeddedEngineAvailability | undefined;
  readonly embedBatch: EmbedBatchFn;
  readonly onOpen?: ((options: EmbeddedEngineOpenOptions | undefined) => void) | undefined;
}

/**
 * An engine with a fixed availability answer and a caller-supplied batch
 * function — the reference shape SERVER-048 implements, and the stand-in the
 * seam's tests and its E2E drive until it does.
 *
 * It exists in `src/` rather than in a test helper because the E2E evidence for
 * this issue is a *real server* resolving an available engine, and a server that
 * can only be shown resolving `disabled` proves half the seam.
 */
export function createStaticEmbeddedEngine(options: StaticEmbeddedEngineOptions): EmbeddedEngine {
  const ref: EmbeddingModelRef = { provider: EMBEDDED_PROVIDER, model: options.model };
  const availability = options.availability ?? { available: true };

  return {
    ref,
    availability: () => Promise.resolve(availability),
    open(openOptions) {
      options.onOpen?.(openOptions);
      if (!availability.available) {
        return Promise.reject(
          new Error(`embedded engine ${ref.model} is unavailable: ${availability.reason}`),
        );
      }
      return Promise.resolve(createEmbeddingProvider(ref, options.embedBatch));
    },
  };
}
