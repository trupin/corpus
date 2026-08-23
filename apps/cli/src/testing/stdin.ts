import { createServer, connect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

/**
 * A piped stdin, as a heredoc or a shell pipe hands one over: an async iterable
 * of chunks that ends. Shared by every body-taking verb's tests so they all
 * exercise the same shape the real `process.stdin` has.
 */
export function pipe(...chunks: readonly string[]): AsyncIterable<string> {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- an async generator is the shape stdin has
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

/**
 * The stdin a verb must never touch: the socket an agent harness leaves on fd 0,
 * which in production never yields and never ends. Iterating it fails the test
 * loudly instead of hanging it, so "this verb would have blocked forever" reads
 * as an assertion rather than a timeout.
 */
export function unreadable(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<string> => ({
      next: () =>
        Promise.reject(
          new Error("stdin was read: in production this descriptor never ends and would hang"),
        ),
    }),
  };
}

/** A live socket descriptor, and the way to give it back. */
export interface ConnectedSocket {
  /** A descriptor `fstat` reports as a socket — the real thing, not a stub. */
  readonly fd: number;
  close(): Promise<void>;
}

/**
 * A **real connected socket**, for the one assertion that cannot be made against
 * an injected value: that `stdinKind()` classifies the descriptor a caller
 * actually gets.
 *
 * `spawn`, `exec` and `spawnSync({ input })` all hand a child a socketpair on
 * fd 0, and an agent harness leaves one there that is never written to and never
 * closed. This is a Unix-domain pair standing in for that: connected, with a
 * peer that writes nothing and closes nothing, so a probe that reads it would
 * hang exactly as production does. Nothing here ever reads it — `fstat` is the
 * whole interaction, which is the property being tested.
 *
 * The numeric descriptor comes off the handle because `net` exposes no public
 * accessor for it, and a probe that takes an `fd` can only be tested with one.
 */
export async function connectedSocket(): Promise<ConnectedSocket> {
  const path = join(tmpdir(), `corpus-stdin-${String(process.pid)}-${String(Date.now())}.sock`);
  const server = await listenOn(path);
  const socket = await connectTo(path);

  const fd = (socket as unknown as { readonly _handle?: { readonly fd?: number } })._handle?.fd;
  if (fd === undefined || fd < 0) {
    throw new Error("this platform gives a connected socket no descriptor to probe");
  }

  return {
    fd,
    close: async () => {
      socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(path, { force: true });
    },
  };
}

function listenOn(path: string): Promise<Server> {
  // A server that never writes and never closes: the peer an agent harness is.
  const server = createServer(() => undefined);
  return new Promise((resolve) => server.listen(path, () => resolve(server)));
}

function connectTo(path: string): Promise<Socket> {
  return new Promise((resolve) => {
    const socket = connect(path, () => resolve(socket));
  });
}
