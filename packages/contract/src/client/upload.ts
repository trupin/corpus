import { ACTOR_HEADER, type Actor } from "../actor.js";
import { CaptureResultSchema, type CaptureResult } from "../schemas/capture.js";
import { ApiErrorSchema, type ApiError } from "../schemas/error.js";
import {
  AppendTurnResponseSchema,
  CreateThreadResponseSchema,
  type AppendTurnResponse,
  type CreateThreadResponse,
} from "../schemas/thread.js";

/**
 * The three multipart endpoints (SPEC.md §6, §8, §9.2), hand-written beside the
 * generated client because `openapi-fetch` serialises JSON: it has no notion of
 * a repeated binary part, and forcing one through its `bodySerializer` would
 * hide the field names this format is entirely about. The shapes are still the
 * contract's — responses are parsed with the same schemas the routes declare, so
 * these helpers cannot drift from the document either.
 */

/** The part name every attachment is sent under, on all three multipart endpoints. */
export const FILES_FIELD = "files";

export interface UploadOptions {
  /** Origin of the workspace server, e.g. `http://127.0.0.1:8765`. */
  readonly baseUrl: string;
  /** Workspace bearer token (SPEC.md §2.1). */
  readonly token: string;
  /** Acting party, and therefore the git author of the auto-commit. Defaults to the server's `user`. */
  readonly actor?: Actor;
  /** Injectable transport, for tests and for runtimes with a non-global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface TurnUpload {
  readonly threadId: string;
  /** Markdown body. Optional: a turn may be attachment-only, but not empty. */
  readonly text?: string;
  /**
   * Tri-state enqueue signal (SPEC.md §8). Omit for the server's default, `true`
   * to request the agent, `false` for "note only" — which suppresses the enqueue
   * even in an engaged thread, and is why this is not defaulted here.
   */
  readonly requestsAgent?: boolean;
  readonly files?: readonly File[];
}

export interface CaptureUpload {
  readonly text: string;
  readonly requestsAgent?: boolean;
  readonly files?: readonly File[];
}

/**
 * The composer's *Ask* with attachments, and a selection comment carrying a file
 * (SPEC.md §6, §8). `text` is optional for the same reason it is on a turn: a
 * first turn may be attachment-only — but not empty.
 */
export interface ThreadUpload {
  readonly parent?: string;
  /** Text-quote selector; serialised into one JSON-encoded part. */
  readonly selector?: {
    readonly exact: string;
    readonly prefix?: string;
    readonly suffix?: string;
  };
  readonly title?: string;
  readonly text?: string;
  readonly requestsAgent?: boolean;
  readonly files?: readonly File[];
}

/** Thrown when a multipart call comes back with a status the route declares as an error. */
export class UploadError extends Error {
  override readonly name = "UploadError";

  constructor(
    readonly status: number,
    message: string,
    /** The parsed problem body, or undefined when the server sent something else. */
    readonly apiError: ApiError | undefined = undefined,
  ) {
    super(message);
  }
}

/**
 * Builds the body for `POST /api/threads/{id}/turns`. Exported so a caller can
 * inspect or extend it (an upload progress wrapper, say) without re-deriving the
 * field names.
 */
export function buildTurnFormData(upload: Omit<TurnUpload, "threadId">): FormData {
  const form = new FormData();
  if (upload.text !== undefined) form.append("text", upload.text);
  if (upload.requestsAgent !== undefined) {
    form.append("requestsAgent", String(upload.requestsAgent));
  }
  for (const file of upload.files ?? []) form.append(FILES_FIELD, file);
  return form;
}

/**
 * Builds the body for the multipart form of `POST /api/threads`. `selector` is
 * JSON-encoded into one part, which is the shape the route declares — every
 * multipart part is text, and flattening the selector into three parts would
 * invent a second spelling of a shape the JSON branch already defines.
 */
export function buildThreadFormData(upload: ThreadUpload): FormData {
  const form = new FormData();
  if (upload.parent !== undefined) form.append("parent", upload.parent);
  if (upload.selector !== undefined) form.append("selector", JSON.stringify(upload.selector));
  if (upload.title !== undefined) form.append("title", upload.title);
  if (upload.text !== undefined) form.append("text", upload.text);
  if (upload.requestsAgent !== undefined) {
    form.append("requestsAgent", String(upload.requestsAgent));
  }
  for (const file of upload.files ?? []) form.append(FILES_FIELD, file);
  return form;
}

export function buildCaptureFormData(upload: CaptureUpload): FormData {
  const form = new FormData();
  form.append("text", upload.text);
  if (upload.requestsAgent !== undefined) {
    form.append("requestsAgent", String(upload.requestsAgent));
  }
  for (const file of upload.files ?? []) form.append(FILES_FIELD, file);
  return form;
}

function uploadHeaders(options: UploadOptions): Record<string, string> {
  // No `content-type`: the runtime sets it with the multipart boundary, and
  // naming it by hand produces a body no server can parse.
  return {
    Authorization: `Bearer ${options.token}`,
    ...(options.actor ? { [ACTOR_HEADER]: options.actor } : {}),
  };
}

async function post<T>(
  options: UploadOptions,
  path: string,
  body: FormData,
  parse: (value: unknown) => T,
): Promise<T> {
  const send = options.fetch ?? globalThis.fetch;
  const response = await send(new URL(path, options.baseUrl), {
    method: "POST",
    headers: uploadHeaders(options),
    body,
  });

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new UploadError(
      response.status,
      parsed.success ? parsed.data.message : `${path} failed with ${String(response.status)}.`,
      parsed.success ? parsed.data : undefined,
    );
  }

  return parse(payload);
}

/**
 * Appends a turn with attachments. Rejects an empty turn before touching the
 * network — the route answers `400` for it too, but a caller that built one has
 * a bug worth surfacing at the call site.
 */
export async function uploadTurn(options: UploadOptions & TurnUpload): Promise<AppendTurnResponse> {
  if (options.text === undefined && (options.files ?? []).length === 0) {
    throw new UploadError(400, "A turn needs `text`, at least one file, or both.");
  }
  return post(
    options,
    `/api/threads/${encodeURIComponent(options.threadId)}/turns`,
    buildTurnFormData(options),
    (value) => AppendTurnResponseSchema.parse(value),
  );
}

/**
 * Creates a thread whose first turn carries attachments. Rejects an empty first
 * turn before touching the network, exactly as {@link uploadTurn} does.
 */
export async function uploadCreateThread(
  options: UploadOptions & ThreadUpload,
): Promise<CreateThreadResponse> {
  if (options.text === undefined && (options.files ?? []).length === 0) {
    throw new UploadError(400, "A thread's first turn needs `text`, at least one file, or both.");
  }
  return post(options, "/api/threads", buildThreadFormData(options), (value) =>
    CreateThreadResponseSchema.parse(value),
  );
}

/** Captures text (and any attachments) as an inbox document plus its filing thread. */
export async function uploadCapture(
  options: UploadOptions & CaptureUpload,
): Promise<CaptureResult> {
  return post(options, "/api/capture", buildCaptureFormData(options), (value) =>
    CaptureResultSchema.parse(value),
  );
}
