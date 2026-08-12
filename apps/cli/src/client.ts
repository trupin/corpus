import {
  createCorpusClient,
  isApiError,
  DEFAULT_ACTOR,
  type Actor,
  type CorpusApi,
} from "@corpus/contract/client";
import { staleKeyError } from "./commands/doc/render.js";
import { ServerResponseError, ServerUnreachableError, type CliError } from "./errors.js";
import type { Workspace } from "./workspace.js";

/**
 * The CLI's single door to the server (CLAUDE.md Architecture Decision 2/3).
 * It wraps the contract's generated client and adds exactly two things:
 * transport-failure classification and typed-problem rendering. It never
 * re-declares paths, re-wraps `fetch`, or hand-builds a request — the contract
 * owns the wire shapes, the CLI owns the exit codes.
 *
 * It reaches into one command module, deliberately: SPEC.md §7's stale-key
 * refusal carries a *document*, and rendering one is `commands/doc/render.ts`'s
 * job rather than something to reimplement here in a second, drifting form.
 * The dependency is a leaf — that module imports the contract and this CLI's
 * error classes and nothing else — and classification stays where every other
 * status is classified, so no verb has to remember to translate a `409`.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Structural shape of an `openapi-fetch` result; kept local so handlers stay untyped-free. */
export interface ClientResult<Data> {
  readonly data?: Data | undefined;
  readonly error?: unknown;
  readonly response: Response;
}

export interface CliClient {
  readonly baseUrl: string;
  readonly api: CorpusApi;
  /**
   * The same typed surface with **no transport deadline**: the caller's own
   * `AbortSignal` is the only thing that ends the request.
   *
   * It exists for one shape of call — the long poll behind `corpus queue idle`,
   * which parks for up to eight minutes. `--timeout` is a *transport* timeout
   * (ten seconds by default, "the server did not answer") and would abort that
   * park as if the server had died. A per-call signal cannot express the
   * exception either: `openapi-fetch` folds it into the `Request` it builds and
   * calls `fetch(request)` with no init, so the wrapper below never sees it and
   * its own deadline wins.
   *
   * A call made through this surface without a signal never times out, so every
   * caller passes one.
   */
  readonly untimedApi: CorpusApi;
  /**
   * Runs one typed call and returns its body, or throws the mapped `CliError`.
   * Handlers write `await client.request((api) => api.GET("/api/health"))`.
   */
  request<Data>(call: (api: CorpusApi) => Promise<ClientResult<Data>>): Promise<Data>;
}

export interface CreateClientOptions {
  readonly workspace: Workspace;
  readonly timeoutMs?: number;
  /**
   * The acting party sent on every request, and therefore the git author of the
   * server's auto-commit. The dispatcher resolves it once from `--from` /
   * `CORPUS_FROM` (CLI-003); it defaults to `user` because a human typing a
   * command is a user, and mis-attributing a human's edit to the agent is the
   * one direction of audit-trail corruption nothing can detect afterwards.
   */
  readonly actor?: Actor;
  /** Injectable transport for tests; production uses the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createClient(options: CreateClientOptions): CliClient {
  const { workspace } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport = options.fetch ?? globalThis.fetch;
  const fetchWithTimeout: typeof globalThis.fetch = (input, init) =>
    transport(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });

  const build = (transportFetch: typeof globalThis.fetch): CorpusApi =>
    createCorpusClient({
      baseUrl: workspace.baseUrl,
      token: workspace.token,
      // Attribution travels with the client, not with each call: a verb that had
      // to remember to set the header could forget to, and the git author is the
      // audit trail (SPEC.md §2.2, §7).
      actor: options.actor ?? DEFAULT_ACTOR,
      fetch: transportFetch,
    }).api;

  const api = build(fetchWithTimeout);

  return {
    baseUrl: workspace.baseUrl,
    api,
    untimedApi: build(transport),
    async request<Data>(call: (client: CorpusApi) => Promise<ClientResult<Data>>): Promise<Data> {
      let result: ClientResult<Data>;
      try {
        result = await call(api);
      } catch (cause) {
        throw transportError(cause, workspace.baseUrl, timeoutMs);
      }

      if (result.response.ok) {
        const { data } = result;
        if (data === undefined) {
          throw new ServerResponseError(
            `${String(result.response.status)} empty_response: the server returned no body.`,
            { code: "empty_response", status: result.response.status },
          );
        }
        return data;
      }
      throw responseError(result.response, result.error);
    },
  };
}

/** Codes that mean "the socket never carried a usable response". */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const NOT_LISTENING_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const ABORT_NAMES: ReadonlySet<string> = new Set(["AbortError", "TimeoutError"]);

export function transportError(cause: unknown, baseUrl: string, timeoutMs: number): Error {
  const { codes, names } = collectCauses(cause);

  if (codes.some((code) => NOT_LISTENING_CODES.has(code))) {
    // Deliberately says nothing about ECONNREFUSED: the actionable fact is the
    // command to run, not the syscall (SPEC.md §2.3).
    return new ServerUnreachableError(
      "server not running for this workspace — run `corpus server start`",
      { hint: `Nothing answered at ${baseUrl}.`, cause },
    );
  }
  if (names.some((name) => ABORT_NAMES.has(name))) {
    return new ServerUnreachableError(
      `the workspace server at ${baseUrl} did not answer within ${String(timeoutMs)}ms`,
      { hint: "If it is not running, start it with `corpus server start`.", cause },
    );
  }
  if (codes.some((code) => UNREACHABLE_CODES.has(code))) {
    return new ServerUnreachableError(`lost the connection to ${baseUrl} before it answered`, {
      hint: "If the server is not running, start it with `corpus server start`.",
      cause,
    });
  }
  return cause instanceof Error ? cause : new Error(String(cause));
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

interface CauseFacts {
  readonly codes: readonly string[];
  readonly names: readonly string[];
}

/** `fetch` buries the real failure under `cause` and, for happy-eyeballs, `AggregateError`. */
function collectCauses(error: unknown, depth = 0): CauseFacts {
  if (depth > 5 || typeof error !== "object" || error === null) return { codes: [], names: [] };

  const codes: string[] = [];
  const names: string[] = [];
  const candidate: { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown } = error;

  if (typeof candidate.code === "string") codes.push(candidate.code);
  if (typeof candidate.name === "string") names.push(candidate.name);

  const nested: unknown[] = [];
  if (candidate.cause !== undefined) nested.push(candidate.cause);
  if (isUnknownArray(candidate.errors)) nested.push(...candidate.errors);

  for (const item of nested) {
    const facts = collectCauses(item, depth + 1);
    codes.push(...facts.codes);
    names.push(...facts.names);
  }
  return { codes, names };
}

export function responseError(response: Response, body: unknown): CliError {
  const status = response.status;
  if (isApiError(body)) {
    // SPEC.md §7's refusal is the one response whose body is the *recovery*
    // rather than a diagnostic — the document as it now stands, carrying a fresh
    // key — so it becomes an error class of its own (exit 9) with its own
    // rendering, instead of a `409` whose payload the caller has to go and dig
    // out of a JSON dump.
    if (body.code === "stale_key") return staleKeyError(status, body.doc);

    return new ServerResponseError(`${String(status)} ${body.code}: ${body.message}`, {
      code: body.code,
      status,
      ...detailsFor(body),
      ...hintFor(status),
    });
  }
  return new ServerResponseError(
    `${String(status)} http_error: ${response.statusText === "" ? "the request failed" : response.statusText}`,
    {
      code: "http_error",
      status,
      ...(body === undefined ? {} : { details: body }),
      ...hintFor(status),
    },
  );
}

function detailsFor(body: { readonly code: string }): { details?: unknown } {
  if ("issues" in body) return { details: body.issues };
  return {};
}

function hintFor(status: number): { hint?: string } {
  if (status === 401) {
    return {
      hint: "The workspace bearer token was rejected — check `token` in .corpus/config.json, or the CORPUS_TOKEN override.",
    };
  }
  return {};
}
