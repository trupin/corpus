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
