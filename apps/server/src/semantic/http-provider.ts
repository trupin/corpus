/**
 * The provider behind an explicitly configured endpoint — the **only** place in
 * the resolution path that opens a socket, and it opens it to the host an
 * operator wrote into `.corpus/config.json` and nowhere else.
 *
 * Two wire shapes cover what people actually run: an Ollama-compatible
 * `/api/embed` (which is also what llama.cpp-style servers expose) and an
 * OpenAI-compatible `/v1/embeddings` (which is what every hosted provider and
 * most gateways expose). Both are parsed with Zod at the boundary, because a
 * proxy answering `200` with an HTML error page is a normal thing to meet on
 * this path and must fail as a provider error rather than as a `TypeError` deep
 * inside the worker.
 *
 * Every string that leaves here — error message, log field — has been through
 * `redactSecrets`. An upstream that echoes the `Authorization` header back in an
 * error body is not hypothetical, and the key must not survive the trip.
 */

import { z } from "zod";
import {
  createEmbeddingProvider,
  redactSecrets,
  EmbeddingError,
  type EmbeddingProvider,
} from "./provider.js";
import type { ConfiguredEmbeddingProvider, ConfiguredProviderKind } from "./settings.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Generous, because a first call may load a model on the far side, and because
 * this never blocks a write — the worker embeds in the background (SERVER-044).
 * It exists so a black-holed endpoint eventually reports rather than hanging a
 * disposer at shutdown.
 */
export const EMBED_TIMEOUT_MS = 30_000;

/** How much of an error body is quoted back; enough to identify it, not enough to be a dump. */
export const ERROR_BODY_LIMIT = 200;

/**
 * The endpoint is written the way an operator thinks of it — the base URL of
 * their server — so the path is appended here, and an operator who wrote the
 * full path anyway is left alone. Anything else turns one config typo into two.
 */
export function embedUrl(kind: ConfiguredProviderKind, endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  if (kind === "ollama") {
    return base.endsWith("/api/embed") ? base : `${base}/api/embed`;
  }
  if (base.endsWith("/embeddings")) return base;
  return base.endsWith("/v1") ? `${base}/embeddings` : `${base}/v1/embeddings`;
}

const OllamaEmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
});

const OpenAiEmbedResponseSchema = z.object({
  data: z.array(
    z.object({ index: z.number().int().min(0).optional(), embedding: z.array(z.number()) }),
  ),
});

/**
 * One body for both shapes: Ollama's `/api/embed` and OpenAI's `/v1/embeddings`
 * agree on `{model, input}` with `input` as an array. Only the response shapes
 * differ, which is why `parseVectors` below is the part that branches.
 */
const requestBody = (model: string, texts: readonly string[]): string =>
  JSON.stringify({ model, input: [...texts] });

function parseVectors(kind: ConfiguredProviderKind, payload: unknown): (readonly number[])[] {
  if (kind === "ollama") {
    const parsed = OllamaEmbedResponseSchema.safeParse(payload);
    if (!parsed.success) throw new EmbeddingError("response did not carry an `embeddings` array");
    return parsed.data.embeddings;
  }
  const parsed = OpenAiEmbedResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new EmbeddingError("response did not carry a `data[].embedding` array");
  // `index` is how the OpenAI shape declares order; entries may legitimately
  // arrive out of it, and a batch silently transposed is a corrupt index.
  const rows = [...parsed.data.data];
  rows.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  return rows.map((row) => row.embedding);
}

export interface ConfiguredProviderDeps {
  readonly fetchFn?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  /** Aborted at shutdown, so an in-flight batch does not outlive the server. */
  readonly signal?: AbortSignal | undefined;
}

/** Builds the provider for a validated `embedding` block. Dials nothing until `embed` is called. */
export function createConfiguredProvider(
  configured: ConfiguredEmbeddingProvider,
  deps: ConfiguredProviderDeps = {},
): EmbeddingProvider {
  const fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? EMBED_TIMEOUT_MS;
  const url = embedUrl(configured.kind, configured.endpoint);
  const secrets = [configured.apiKey];
  const clean = (text: string): string => redactSecrets(text, secrets);

  return createEmbeddingProvider(
    { provider: configured.kind, model: configured.model },
    async (texts) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = deps.signal === undefined ? timeout : AbortSignal.any([timeout, deps.signal]);

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(configured.apiKey === undefined
              ? {}
              : { authorization: `Bearer ${configured.apiKey}` }),
          },
          body: requestBody(configured.model, texts),
          signal,
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new EmbeddingError(
          `${configured.kind} endpoint ${url} is unreachable: ${clean(reason)}`,
          {
            cause,
          },
        );
      }

      if (!response.ok) {
        // A refused model — Ollama's "model not found, try pulling it first" —
        // arrives here, and it is a provider failure like any other: the seam
        // does not re-resolve behind an operator's back.
        const body = await response.text().catch(() => "");
        const snippet = clean(body.slice(0, ERROR_BODY_LIMIT)).replace(/\s+/g, " ").trim();
        throw new EmbeddingError(
          `${configured.kind} endpoint ${url} answered ${response.status}` +
            (snippet === "" ? "" : `: ${snippet}`),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        throw new EmbeddingError(`${configured.kind} endpoint ${url} answered with invalid JSON`, {
          cause,
        });
      }

      try {
        return parseVectors(configured.kind, payload);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new EmbeddingError(`${configured.kind} endpoint ${url}: ${clean(reason)}`, { cause });
      }
    },
  );
}
