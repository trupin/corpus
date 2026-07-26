import createClient, { type Client } from "openapi-fetch";
import { ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "../actor.js";
import { createEventStream, type EventStream, type EventStreamOptions } from "./events.js";
import type { paths } from "./schema.generated.js";

/**
 * The one client both the CLI and the UI use (SPEC.md §9.3). It is a thin,
 * hand-written wrapper over `openapi-fetch` and the generated `paths` types:
 * the wrapper owns auth and actor attribution, the generated types own the
 * request/response shapes, so drift between server and clients is a type error.
 */

export type { paths } from "./schema.generated.js";
export type { components, operations } from "./schema.generated.js";
export {
  createEventStream,
  eventStreamUrl,
  type EventSourceFactory,
  type EventSourceLike,
  type EventStream,
  type EventStreamOptions,
} from "./events.js";
export { isApiError, type ApiError } from "../schemas/error.js";
export { ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "../actor.js";

/** The generated fetch surface: one method per HTTP verb, keyed by contract path. */
export type CorpusApi = Client<paths>;

export interface CorpusClientOptions {
  /** Origin of the workspace server, e.g. `http://127.0.0.1:8765`. */
  readonly baseUrl: string;
  /** Workspace bearer token from `.corpus/config.json` (SPEC.md §2.1). */
  readonly token: string;
  /**
   * Acting party sent on every request, and therefore the git author of the
   * server's auto-commit. The CLI passes `agent`; the UI leaves the default.
   * Individual calls may still override it via `params.header`.
   */
  readonly actor?: Actor;
  /** Injectable transport, for tests and for runtimes with a non-global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface CorpusClient {
  readonly baseUrl: string;
  /** Typed fetch calls: `client.api.GET("/api/docs", { params: { query: { q } } })`. */
  readonly api: CorpusApi;
  /**
   * Opens the SSE invalidation stream. Not part of `api` because EventSource is
   * not fetch — the contract documents `GET /events`, the client wraps it.
   */
  connectEvents(options: Omit<EventStreamOptions, "baseUrl" | "token">): EventStream;
}

export function createCorpusClient(options: CorpusClientOptions): CorpusClient {
  const actor = options.actor ?? DEFAULT_ACTOR;
  const api = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  api.use({
    onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${options.token}`);
      // A per-call `params.header` override has already been applied, so only
      // fill in the default when the caller said nothing.
      if (!request.headers.has(ACTOR_HEADER)) {
        request.headers.set(ACTOR_HEADER, actor);
      }
      return request;
    },
  });

  return {
    baseUrl: options.baseUrl,
    api,
    connectEvents: (streamOptions) =>
      createEventStream({ ...streamOptions, baseUrl: options.baseUrl, token: options.token }),
  };
}
