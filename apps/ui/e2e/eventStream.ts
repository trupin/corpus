import { createServer, type Server, type ServerResponse } from "node:http";
import { INVALIDATE_EVENT, type InvalidatePayload, type QueryKey } from "@corpus/contract";
import type { Page } from "@playwright/test";

/**
 * A **real** `/events` stream for the specs that are about the transport itself
 * (SPEC.md §2.2 rule 3, §10 "Live updates").
 *
 * `stubCorpus` answers `/api/**` from inside the page and pushes nothing: every
 * repaint a stubbed spec sees is driven by a mutation's own
 * `invalidateQueries`. That is the right shape for a spec about *what the board
 * does*, and it is exactly the wrong shape for a spec about **what arrives
 * without the browser asking** — a form answered in another column, another tab
 * or by the agent itself. Those land as an `invalidate` frame or they do not
 * land at all, and a stub that pushes nothing cannot tell the two apart.
 *
 * So this is a genuine `text/event-stream` over the loopback: a Node server on
 * an ephemeral port (never 8765, never 5173 — nothing here picks a port at all),
 * the browser's own `EventSource` opening it, the contract's `createEventStream`
 * parsing the frames and the kit's `SseBridge` mapping them onto the cache. The
 * only substitution is *where the stream lives*: `page.addInitScript` rewrites
 * the URL the constructor is handed, because the dev server proxies `/events`
 * to the workspace server (`vite.config.ts`) and a stubbed spec has no
 * workspace server — the proxy would reach whatever happens to hold 8765 on the
 * machine, which is a real server belonging to somebody else.
 *
 * The frame format mirrors `apps/server/src/events/sse.ts` byte for byte; the
 * event **name** is imported from the contract rather than spelled again, which
 * is the half that could drift.
 */

export interface StubEventStream {
  /** Where the page's `EventSource` was pointed. */
  readonly url: string;
  /** Streams currently held open by the page. */
  readonly connections: () => number;
  /** Resolves once the page has opened the stream — never assumed. */
  readonly waitForConnection: (timeoutMs?: number) => Promise<void>;
  /**
   * Announces that these query keys went stale, to every open stream — the one
   * thing the server ever sends over SSE (it never pushes data).
   */
  readonly push: (keys: readonly QueryKey[]) => void;
  readonly close: () => Promise<void>;
}

const frame = (keys: readonly QueryKey[]): string =>
  `event: ${INVALIDATE_EVENT}\ndata: ${JSON.stringify({ keys: [...keys] } satisfies InvalidatePayload)}\n\n`;

/**
 * Starts the stream and points `page`'s `EventSource` at it. Call **before**
 * `page.goto`: the bridge connects on first render, and an init script added
 * afterwards would arrive after the constructor it is meant to wrap.
 */
export async function stubEventStream(page: Page): Promise<StubEventStream> {
  const open = new Set<ServerResponse>();

  const server: Server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": request.headers.origin ?? "*",
        "access-control-allow-headers": "*",
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      // `EventSource` is a cross-origin GET here (the page is the dev server's
      // origin, this is loopback on another port) and carries no credentials,
      // so echoing the origin is all CORS asks for.
      "access-control-allow-origin": request.headers.origin ?? "*",
    });
    // A comment line flushes the headers, which is what fires `open` on the
    // client and what `waitForConnection` is waiting for.
    response.write(": connected\n\n");
    open.add(response);
    request.on("close", () => open.delete(response));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stubEventStream: the server reported no TCP address");
  }
  const url = `http://127.0.0.1:${String(address.port)}/events`;

  await page.addInitScript((target: string) => {
    const Native = window.EventSource;
    class RoutedEventSource extends Native {
      constructor(_url: string | URL, init?: EventSourceInit) {
        super(target, init);
      }
    }
    window.EventSource = RoutedEventSource;
  }, url);

  return {
    url,
    connections: () => open.size,
    waitForConnection: async (timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (open.size === 0) {
        if (Date.now() > deadline) {
          throw new Error(`stubEventStream: the page never opened ${url}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    push: (keys) => {
      const text = frame(keys);
      for (const response of open) {
        // A socket the page closed a tick ago is still in the set until its
        // `close` fires; writing to it must not raise on this process.
        if (response.writableEnded) continue;
        response.write(text, () => undefined);
      }
    },
    close: async () => {
      for (const response of open) response.end();
      open.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
