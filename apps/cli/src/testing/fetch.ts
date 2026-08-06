/**
 * A scripted `fetch`, for the one thing the CLI talks to that is not the
 * workspace server: the GitHub Releases API and the assets it points at
 * (`corpus upgrade`, SPEC.md §2.4).
 *
 * The queue and lock verbs drive a real socket (`./stub-server.ts`) because
 * their behaviour *is* socket behaviour. Here it is the opposite: what matters
 * is which URL was asked for and what came back, and a suite that reached the
 * real API would be the background check §2.4 forbids, running on every
 * `npm test`, against a rate limit.
 */

export type FetchInput = Parameters<typeof globalThis.fetch>[0];

/** The URL a `fetch` argument names, in whichever of its three shapes it arrived. */
export function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return (input, init) => Promise.resolve(handler(requestUrl(input), init));
}
