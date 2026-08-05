/**
 * The pinned method+path inventory of the Corpus HTTP API — every endpoint
 * SPEC.md §9.2 lists, plus the queue, lock and job verbs §7 requires, the
 * projection-maintenance pair behind §2.2's `corpus db rebuild` / `db doctor`,
 * and the validation and loop-safety pair `POST /api/check` and
 * `POST /api/skills/{name}/rollback`. Those two were derived from the
 * behavioural sections before §9.2 listed them (§14's "`corpus doc check`
 * exposes the same validator on demand", §7's "`corpus skill rollback <name>` —
 * a targeted git revert, performed by the server"); the amendment CONTRACT-008
 * drafted for them is signed off and applied — §9.2 now names both in its own
 * bullets (SPEC.md:323-325, SHARED-002).
 *
 * `POST /api/skills` (CONTRACT-020) was derived the same way, from §7's skill
 * genesis: the agent creates a skill, and it can only reach the workspace
 * through the CLI and the server. §9.2 now lists it in its own bullet (signed
 * off and applied 2026-07-30, PR #12 review — SHARED-003's sign-off record).
 *
 * `GET /api/search` and `GET /api/docs/{id}/related` (CONTRACT-022) are §7
 * Retrieval discipline's two agent-facing verbs, and §9.2 lists both in their
 * own bullets — SHARED-006 Edits 7 and 8, signed 2026-07-30 and applied as this
 * phase branch's kickoff commit. Nothing in this repository parses `SPEC.md`, so
 * the agreement between those bullets and these two entries is review
 * discipline: the parameter lists were walked item by item against the applied
 * text in CONTRACT-022's E2E log, the way the amendments above were.
 *
 * `GET /api/index/status` and `POST /api/index/rebuild` (CONTRACT-023) are
 * §9.1's two semantic-index verbs, and §9.2 lists both in a single bullet whose
 * spellings these two entries reproduce. They sit between `POST /api/check` and
 * `POST /api/skills` because that is where §9.2's own bullet order puts them.
 * The same review discipline applies as to the retrieval pair above: the bullet
 * was quoted verbatim into CONTRACT-023's E2E log and walked against these
 * entries by hand, because nothing here parses `SPEC.md`.
 *
 * `GET /api/threads/{id}/context` (CONTRACT-024) is Retrieval Phase C's single
 * endpoint — §7's context-packs paragraph and §9.2's own bullet, both signed as
 * SHARED-006 Edits 4 and 9. It sits immediately after `GET /api/threads/{id}`
 * because that is where §9.2's bullet order puts it, and the same review
 * discipline applies as to every entry above: the bullet was quoted verbatim
 * into CONTRACT-024's E2E log and walked phrase by phrase against the route
 * definition by hand, because nothing here parses `SPEC.md`.
 *
 * `GET /api/docs/{id}/diff` (CONTRACT-028) is derived exactly as `POST
 * /api/skills` was, and the derivation is worth stating because §9.2 does not
 * yet list it. SPEC.md §4's edit-acknowledgment rider (signed 2026-08-02) names
 * the CLI verb — "a new CLI verb (`corpus doc diff <id>`) fetches the actual
 * diff on demand" — and the CLI is a thin HTTP client that performs no direct
 * file reads of git history (CLAUDE.md Architecture Decision 2), so the verb is
 * a server endpoint by construction. It sits immediately after
 * `GET /api/docs/{id}/related` because both are one-segment reads off a
 * document. A §9.2 bullet and a §7 "Core event types" clause for the
 * accompanying `doc.edited` type are **drafted and held for user sign-off**
 * (CONTRACT-028's E2E log) rather than applied here: this package never edits
 * SPEC.md, and the rider that authorises both is already signed.
 *
 * `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031) is the other half of
 * that same rider, and it is here because a premise stated in CONTRACT-028 was
 * measured and found false. §4 names two ends for a user edit session, one of
 * them "the reader closes (the UI flushes the session)"; CONTRACT-028 read that
 * flush as §7's edit-lock release and declared no endpoint for it. SERVER-052
 * checked that against the shipped editor, which drops the lease on blur and
 * after ten seconds of not typing against the session's three minutes — so the
 * lock always wins and §4's explicitly "distinct and longer window" would never
 * be reached. A close signal of its own is therefore what the signed rider
 * requires, and §9.3 makes it a route declared here rather than one invented in
 * the server. It sits immediately after `GET /api/docs/{id}/diff` because those
 * two are §4's whole surface. A §9.2 bullet for it is **drafted and held for
 * user sign-off** (CONTRACT-031's issue file), like the two above.
 *
 * This list is the contract's own spec-compliance test: `openapi.test.ts`
 * asserts the generated document's paths × methods set equals it exactly, so
 * adding an endpoint to SPEC.md without declaring it here fails a test, and
 * declaring a route nobody asked for fails the same test from the other side.
 *
 * Deliberately absent, so neither omission reads as a gap:
 * - **Plugin routes** (`/api/x/<plugin>/…`) — discovered at runtime from the
 *   plugin directory (SPEC.md §10), never declared in a static document.
 * - **`GET /api/openapi.json`** — the server's own introspection endpoint, which
 *   serves the live document behind the bearer guard. It is server-local rather
 *   than client-facing: no typed client method should exist for it, so it is not
 *   contract surface.
 */
export const ENDPOINT_INVENTORY = [
  "GET /api/health",

  "GET /api/docs",
  "POST /api/docs",
  "GET /api/docs/{id}",
  "GET /api/docs/{id}/related",
  "GET /api/docs/{id}/diff",
  "POST /api/docs/{id}/edit-session/flush",
  "PUT /api/docs/{id}",
  "DELETE /api/docs/{id}",
  "POST /api/docs/{id}/move",
  "POST /api/docs/{id}/archive",
  "POST /api/docs/{id}/unarchive",

  "GET /api/search",

  "GET /api/tree",
  "POST /api/capture",

  "POST /api/threads",
  "GET /api/threads/{id}",
  "GET /api/threads/{id}/context",
  "POST /api/threads/{id}/turns",
  "DELETE /api/threads/{id}/turns/{ts}",
  "POST /api/threads/{id}/turns/{ts}/form",
  "POST /api/threads/{id}/resolve",
  "POST /api/threads/{id}/reopen",
  "POST /api/threads/{id}/seen",

  "GET /api/queue/status",
  "GET /api/queue/idle",
  "POST /api/queue/claim-all",
  "POST /api/queue/reap-stale",
  "POST /api/queue/halt",
  "POST /api/queue/resume",
  "POST /api/queue/{id}/complete",
  "POST /api/queue/{id}/fail",
  "POST /api/queue/{id}/defer",
  "DELETE /api/queue/{id}",

  "GET /api/locks",
  "POST /api/locks/reap",
  "POST /api/locks/{docId}",
  "DELETE /api/locks/{docId}",
  "POST /api/locks/{docId}/break",

  "GET /api/jobs",
  "GET /api/jobs/{id}/log",
  "POST /api/jobs/{id}/log",
  "POST /api/jobs/{id}/retry",
  "POST /api/jobs/{id}/abandon",

  "POST /api/db/rebuild",
  "GET /api/db/doctor",

  "POST /api/check",

  "GET /api/index/status",
  "POST /api/index/rebuild",

  "POST /api/skills",
  "POST /api/skills/{name}/rollback",

  "GET /events",
  "GET /attachments/{path}",
] as const;

export type EndpointSignature = (typeof ENDPOINT_INVENTORY)[number];

/** `GET /api/docs` — the spelling both the inventory and the generated document use. */
export const endpointSignature = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path}`;
