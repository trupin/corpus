import type { Doc, DocRow, Lock } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import type { ReactElement, ReactNode } from "react";

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

/** A `Doc` with the frontmatter a `todo` document carries; `extra` verbatim. */
export function todoDoc(id: string, extra: Readonly<Record<string, unknown>>): Doc {
  return {
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
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra,
    },
    body: "## Notes\n\nThe raw body, shown when the items cannot be read.\n",
    path: `data/docs/todos/${id}.md`,
    anchors: [],
  };
}

export interface TransportOptions {
  /** Rows `GET /api/docs` answers with. */
  readonly docs: readonly DocRow[];
  /** The document `GET /api/docs/{id}` answers with. */
  readonly doc: Doc;
  /** Locks `GET /api/locks` answers with. */
  readonly locks: readonly Lock[];
  /** What every `/api/x/todos/*` request answers with. */
  readonly write: { readonly status: number; readonly body: unknown };
}

const DEFAULTS: TransportOptions = {
  docs: [],
  doc: todoDoc("doc_default", { items: [] }),
  locks: [],
  write: { status: 200, body: { ok: true } },
};

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

/** Answers `/api/docs`, `/api/docs/{id}`, `/api/locks`, `/api/jobs` and `/api/x/todos/*`. */
export function transport(overrides: Partial<TransportOptions>): Transport {
  const options: TransportOptions = { ...DEFAULTS, ...overrides };
  const calls: RecordedCall[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    // Two callers, two shapes: `openapi-fetch` (every core hook) hands a
    // `Request`, while the kit's `pluginRequest` hands a URL string and an init.
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;

    if (path.startsWith("/api/x/todos")) {
      return Promise.resolve(json(options.write.body, options.write.status));
    }
    if (path === "/api/locks") return Promise.resolve(json({ locks: options.locks }, 200));
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
