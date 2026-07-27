// Request → acting party (SPEC.md §4, §7).
//
// The header is **`x-corpus-author`** — the contract's `ACTOR_HEADER`, declared
// on every mutating route via `ActorHeaderSchema`, optional, defaulting to
// `user`. A request carrying some *other* spelling is simply a request with no
// actor header: this API does not reject unknown headers, so `X-Corpus-Actor`
// (which no route declares) is authored by `user`, exactly as a bare request is.

import { ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "@corpus/contract";

/** The acting party a validated header bag names, or the documented default. */
export function actorOf(headers: Partial<Record<string, string>>): Actor {
  const value = headers[ACTOR_HEADER];
  return value === "agent" || value === "user" ? value : DEFAULT_ACTOR;
}
