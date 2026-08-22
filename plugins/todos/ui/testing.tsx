import type { Doc, DocRow, ResolvedAnchor } from "@corpus/contract";
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import type { ReactElement, ReactNode } from "react";
import { openItems, parseBodyItems, updateItemInBody, type TodoItem } from "../items.js";

/**
 * The plugin's own test scaffolding: a mounted kit data layer plus a `fetch`
 * that answers exactly the routes these components read.
 *
 * A plugin cannot reach `apps/ui`'s board fixtures (SPEC.md §10 — the kit is
 * the whole import surface), which is the point rather than a limitation: what
 * a plugin can test with is what a plugin author has. Everything below is built
 * from `@corpus/kit/testing`'s harness and the contract's own types.
 *
 * Deliberately branch-free: `plugins/*⁠/**` is inside the repository's coverage
 * gate (sprint-012 Adjudication 10), and a helper full of unexercised defaults
 * would drag the branch metric down while proving nothing.
 */

export const TS = "2026-07-20T09:00:00.000Z";

/**
 * A body of task-list lines — where a todo document's items live since
 * PLUGINS-005. `[text, done, due?]` per item, in the order they appear.
 */
export function todoBody(items: readonly (readonly [string, boolean, string?])[]): string {
  const lines = items.map(
    ([text, done, due]) =>
      `- [${done ? "x" : " "}] ${text}${due === undefined ? "" : ` (due: ${due})`}`,
  );
  return `## Notes\n\n${lines.join("\n")}\n`;
}

/**
 * SPEC.md §7's key, in the shape a read hands one out: 64 lowercase hexadecimal
 * characters, different for every document.
 *
 * The **value** is a stand-in — the real one is a digest of the document's
 * stored bytes, which only the server can take — and no board surface may ever
 * depend on more than that. A key is opaque: the UI reads a document, keeps the
 * key it was given, and presents it back on a body write. Nothing here parses
 * one, and nothing here is a lock: §7 removed the thing that could be held, and
 * §10 says the board is never read-only.
 */
export function fixtureKey(id: string): string {
  let hash = 0x811c9dc5;
  const parts: string[] = [];
  for (let round = 0; round < 8; round += 1) {
    for (let at = 0; at < id.length; at += 1) {
      hash ^= id.charCodeAt(at) + round;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    parts.push(hash.toString(16).padStart(8, "0"));
  }
  return parts.join("");
}

/**
 * A `Doc` with the frontmatter a `todo` document carries.
 *
 * `extra` is passed verbatim so a test can still build a **pre-migration**
 * document (its items in the legacy `items` key); `body` is where a migrated
 * document's items are, and is what production documents look like.
 */
export function todoDoc(
  id: string,
  extra: Readonly<Record<string, unknown>>,
  body = "## Notes\n\nThe raw body, shown when the items cannot be read.\n",
): Doc {
  return {
    key: fixtureKey(id),
    // The advisory §7 signal that travels beside the key: information, never a
    // gate, and nothing in this plugin reads it.
    userEditing: false,
    frontmatter: {
      id,
      type: "todo",
      title: `List ${id}`,
      created: TS,
      updated: TS,
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra,
    },
    body,
    path: `data/docs/todos/${id}.md`,
    anchors: [],
  };
}

export interface TransportOptions {
  /** Rows `GET /api/docs` answers with. */
  readonly docs: readonly DocRow[];
  /** The document `GET /api/docs/{id}` answers with. */
  readonly doc: Doc;
  /**
   * What the plugin's aggregate (`GET /api/x/todos/lists…`) answers with — the
   * one read both row surfaces share since PLUGINS-007. `null` falls through to
   * {@link TransportOptions.write}, which is how a test drives a failure.
   */
  readonly lists: readonly Record<string, unknown>[] | null;
  /** What every other `/api/x/todos/*` request answers with. */
  readonly write: { readonly status: number; readonly body: unknown };
}

const DEFAULTS: TransportOptions = {
  docs: [],
  doc: todoDoc("doc_default", {}),
  lists: [],
  write: { status: 200, body: { ok: true } },
};

/** One entry of the aggregate's payload, as `server/routes.ts` reports it. */
export function listPayload(
  docId: string,
  title: string,
  items: readonly { readonly text: string; readonly done: boolean; readonly due?: string }[],
): Record<string, unknown> {
  const done = items.filter((item) => item.done).length;
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

export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export interface Transport {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
  /** Only the plugin's own route calls — what a write assertion is about. */
  pluginCalls(): readonly RecordedCall[];
}

const json = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Answers `/api/docs`, `/api/docs/{id}`, `/api/jobs` and `/api/x/todos/*`. */
export function transport(overrides: Partial<TransportOptions>): Transport {
  const options: TransportOptions = { ...DEFAULTS, ...overrides };
  const calls: RecordedCall[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    // Two callers, two shapes: `openapi-fetch` (every core hook) hands a
    // `Request`, while the kit's `pluginRequest` hands a URL string and an init.
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;

    if (path.startsWith("/api/x/todos/lists") && options.lists !== null) {
      return Promise.resolve(json({ lists: options.lists }, 200));
    }
    if (path.startsWith("/api/x/todos")) {
      return Promise.resolve(json(options.write.body, options.write.status));
    }
    if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }, 200));
    if (path.startsWith("/api/docs/")) return Promise.resolve(json(options.doc, 200));
    return Promise.resolve(
      json(
        { items: options.docs, page: { total: options.docs.length, limit: 50, offset: 0 } },
        200,
      ),
    );
  };

  return {
    fetch: fetchStub,
    calls,
    pluginCalls: () => calls.filter((call) => call.url.includes("/api/x/todos")),
  };
}

/**
 * A **stateful** transport: the plugin's item routes actually rewrite a body,
 * and `GET /lists` is recomputed from that body every time it is asked.
 *
 * That is what makes "the row leaves the column without a reload" an assertion
 * about the application rather than about a fixture — a column that did not
 * re-read would keep showing the item it just checked off, and a column that
 * hid it optimistically would keep hiding it after the server refused.
 *
 * Shared by the item-menu tests and the checkbox tests because both are the
 * same write path reached two ways (PLUGINS-015).
 */
export const STATEFUL_BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [x] Send the signed form",
  "- [ ] Book the passport appointment (due: 2026-08-01)",
  "- [ ] Call the plumber",
  "",
].join("\n");

export interface StatefulWire extends Transport {
  /** The document body as the stub currently holds it. */
  body(): string;
  /** Only the item-route writes — `PUT /api/x/todos/{doc}/items/{index}`. */
  readonly pluginWrites: () => readonly RecordedCall[];
}

export interface StatefulWireOptions {
  /** Status the item route answers with; 200 applies the write. */
  readonly itemStatus?: number;
  /** What `GET /api/docs/{id}` reports as resolved anchors. */
  readonly anchors?: readonly ResolvedAnchor[];
  /** The body the stub starts from; defaults to {@link STATEFUL_BODY}. */
  readonly body?: string;
}

/** The JSON a recorded call carried, which `pluginRequest` always sends as a string. */
export function sentJson(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

export function statefulTodoWire(options: StatefulWireOptions = {}): StatefulWire {
  let body = options.body ?? STATEFUL_BODY;
  const calls: RecordedCall[] = [];
  const status = options.itemStatus ?? 200;

  const listView = (): Record<string, unknown> => {
    const items: readonly TodoItem[] = parseBodyItems(body);
    return {
      docId: "doc_week",
      title: "Week of Jul 20",
      path: "data/docs/todos/doc_week.md",
      status: "open",
      open: openItems(items).length,
      done: items.length - openItems(items).length,
      items,
    };
  };

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");

    if (path.startsWith("/api/x/todos/lists")) {
      return Promise.resolve(json({ lists: [listView()] }, 200));
    }

    const item = /^\/api\/x\/todos\/([^/]+)\/items\/(\d+)$/.exec(path);
    if (item !== null && method === "PUT") {
      if (status !== 200) {
        return Promise.resolve(
          json({ code: "conflict", message: "it changed under you; nothing was written" }, status),
        );
      }
      body = updateItemInBody(body, Number(item[2]), sentJson(init));
      return Promise.resolve(json({ docId: item[1], index: Number(item[2]) }, 200));
    }

    if (path === "/api/threads" && method === "POST") {
      return Promise.resolve(
        json({ thread: { id: "th_new1" }, anchorId: "anc_new1", warnings: [] }, 201),
      );
    }
    if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }, 200));
    if (path.startsWith("/api/docs/")) {
      return Promise.resolve(
        json(
          {
            ...todoDoc("doc_week", {}, body),
            frontmatter: { ...todoDoc("doc_week", {}, body).frontmatter, title: "Week of Jul 20" },
            path: "data/docs/todos/doc_week.md",
            anchors: options.anchors ?? [],
          },
          200,
        ),
      );
    }
    const rows = [docRowFixture({ id: "doc_week", type: "todo", title: "Week of Jul 20" })];
    return Promise.resolve(json({ items: rows, page: { total: 1, limit: 50, offset: 0 } }, 200));
  };

  return {
    fetch: fetchStub,
    calls,
    body: () => body,
    pluginCalls: () => calls.filter((call) => call.url.includes("/api/x/todos")),
    pluginWrites: () => calls.filter((call) => /\/api\/x\/todos\/[^/]+\/items\//.test(call.url)),
  };
}

/**
 * In-memory `Storage` doubles, for the same reason `apps/ui` has its own: the
 * ambient `localStorage` under the runner is not dependable — Node 25 defines a
 * Web Storage global that shadows jsdom's and is inert without
 * `--localstorage-file`. The plugin cannot import `apps/ui`'s copy (SPEC.md §10
 * — the kit is the whole import surface), and the real path is covered in a
 * real browser by the E2E drill.
 */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

/** Models Safari private mode and sandboxed frames, where access throws. */
export function throwingStorage(): Storage {
  const reject = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return reject();
    },
    clear: reject,
    getItem: reject,
    key: reject,
    removeItem: reject,
    setItem: reject,
  };
}

export interface MountedHarness {
  readonly Wrapper: (props: { readonly children?: ReactNode }) => ReactElement;
  /** How many queries are in flight — how a test waits for the layer to settle. */
  fetching(): number;
}

/**
 * A wrapper mounting the kit's provider around whatever a test renders.
 *
 * {@link MountedHarness.fetching} matters more than it looks: a refetch issued
 * while the first fetch is still in flight is **deduped into it**, so a test
 * that clicks before the layer settles proves nothing about refetching.
 */
export function wrapperFor(wire: Transport): MountedHarness {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  return {
    Wrapper: function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
      return <harness.Wrapper>{children}</harness.Wrapper>;
    },
    fetching: () => harness.queryClient.isFetching(),
  };
}
