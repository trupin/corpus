import createClient, { type Client } from "openapi-fetch";
import { ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "../actor.js";
import type { CaptureResult } from "../schemas/capture.js";
import type { AppendTurnResponse } from "../schemas/thread.js";
import { createEventStream, type EventStream, type EventStreamOptions } from "./events.js";
import type { paths } from "./schema.generated.js";
import {
  uploadCapture,
  uploadTurn,
  type CaptureUpload,
  type TurnUpload,
  type UploadOptions,
} from "./upload.js";

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
export {
  buildCaptureFormData,
  buildTurnFormData,
  uploadCapture,
  uploadTurn,
  UploadError,
  FILES_FIELD,
  type CaptureUpload,
  type TurnUpload,
  type UploadOptions,
} from "./upload.js";
export { isApiError, type ApiError } from "../schemas/error.js";
export { ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "../actor.js";
/**
 * The SSE query-key vocabulary, re-exported here because the UI's invalidation
 * bridge is a client concern. `../query-keys.js` imports nothing, so a consumer
 * that wants only the key names never pulls the validator in with them.
 */
export {
  DOCS_KEY,
  JOBS_KEY,
  LOCKS_KEY,
  QUERY_KEY_NAMES,
  QUERY_KEY_VOCABULARY,
  QUEUE_KEY,
  TREE_KEY,
  describeQueryKeyVocabulary,
  docKey,
  jobKey,
  lockKey,
  threadKey,
  type QueryKey,
  type QueryKeyName,
  type QueryKeySegment,
  type QueryKeyShape,
} from "../query-keys.js";

/**
 * The paths the fetch client covers. Two documented paths are excluded on
 * purpose, both because a generated fetch method would hand callers a response
 * they must not read that way:
 *
 * - `/events` is an SSE stream, and `openapi-typescript` can only describe its
 *   body as a string. The stream is reached through `connectEvents` /
 *   `createEventStream` instead, which is also the only way to attach the token
 *   EventSource cannot send as a header.
 * - `/attachments/{path}` serves raw bytes as `application/octet-stream`, which
 *   `openapi-fetch` would run through `JSON.parse` — corrupting or throwing on
 *   every image and every download. Attachment URLs belong in `<img src>` and
 *   download links (see the route's own note), not behind a fetch wrapper.
 */
export type FetchPaths = Omit<paths, "/events" | "/attachments/{path}">;

/** The generated fetch surface: one method per HTTP verb, keyed by contract path. */
export type CorpusApi = Client<FetchPaths>;

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
  /**
   * Appends a turn with attachments. Not part of `api` because `openapi-fetch`
   * serialises JSON; multipart needs a `FormData` whose boundary the runtime owns.
   */
  uploadTurn(upload: TurnUpload): Promise<AppendTurnResponse>;
  /** Captures text and attachments as an inbox document plus its filing thread. */
  capture(upload: CaptureUpload): Promise<CaptureResult>;
}

export function createCorpusClient(options: CorpusClientOptions): CorpusClient {
  const actor = options.actor ?? DEFAULT_ACTOR;
  const api = createClient<FetchPaths>({
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

  const uploadOptions: UploadOptions = {
    baseUrl: options.baseUrl,
    token: options.token,
    actor,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  return {
    baseUrl: options.baseUrl,
    api,
    connectEvents: (streamOptions) =>
      createEventStream({ ...streamOptions, baseUrl: options.baseUrl, token: options.token }),
    uploadTurn: (upload) => uploadTurn({ ...uploadOptions, ...upload }),
    capture: (upload) => uploadCapture({ ...uploadOptions, ...upload }),
  };
}
