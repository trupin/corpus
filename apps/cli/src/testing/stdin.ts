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
