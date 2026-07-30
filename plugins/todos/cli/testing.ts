import type { PluginCommandContext } from "@corpus/contract/plugin";

/**
 * A `PluginCommandContext` a test can drive, plus the recorded HTTP traffic.
 *
 * `apps/cli`'s real context is built from classes with `#private` fields
 * (`ParsedArgs`, `ParsedFlags`), which is exactly why CONTRACT-015 publishes
 * the plain-object *views* a plugin verb actually uses — and why a plugin can
 * write this harness at all. It is deliberately branch-free: `plugins/*⁠/**` is
 * inside the coverage gate, and a helper full of unexercised defaults would
 * drag the branch metric while proving nothing.
 */

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
  /**
   * The response body verbatim, instead of `body` as JSON — the only way to
   * pose the question "what does a verb do when the thing answering is not the
   * server it thinks it is?" (a proxy's HTML error page, a truncated body).
   */
  readonly text?: string | undefined;
}

export interface CliHarness {
  readonly context: PluginCommandContext;
  readonly requests: RecordedRequest[];
  /** Everything `out.emit` was given — at most one value, per SPEC.md §2.3. */
  readonly emitted: unknown[];
  readonly lines: string[];
}

export interface HarnessInput {
  readonly args: Readonly<Record<string, string>>;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly actor: "user" | "agent";
  /** Answers, in order, for each request the verb makes. */
  readonly replies: readonly Reply[];
}

const BASE_URL = "http://127.0.0.1:9142";

export function cliHarness(input: HarnessInput): CliHarness {
  const requests: RecordedRequest[] = [];
  const emitted: unknown[] = [];
  const lines: string[] = [];
  const replies = [...input.replies];

  globalThis.fetch = ((url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    requests.push({
      url,
      method: String(init.method),
      headers,
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const reply = replies.shift() as Reply;
    return Promise.resolve(
      new Response(reply.text ?? JSON.stringify(reply.body), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;

  const context: PluginCommandContext = {
    args: {
      get: (name) => String(input.args[name]),
      optional: (name) => input.args[name],
    },
    flags: {
      boolean: (name) => input.flags[name] === true,
      string: (name) => input.flags[name] as string | undefined,
      number: () => undefined,
      strings: () => [],
    },
    out: {
      emit: (value) => emitted.push(value),
      line: (text) => lines.push(text),
    },
    workspace: { baseUrl: BASE_URL, token: "test-token" },
    client: { baseUrl: BASE_URL },
    actor: input.actor,
    cwd: "/tmp",
    env: {},
    version: "0.0.0",
  };

  return { context, requests, emitted, lines };
}

/** One `/lists` payload entry, as the plugin's route reports it. */
export function listPayload(
  docId: string,
  title: string,
  items: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const done = items.filter((entry) => entry["done"] === true).length;
  return {
    docId,
    title,
    path: `data/docs/todos/${docId}.md`,
    status: "open",
    open: items.length - done,
    done,
    items,
  };
}
