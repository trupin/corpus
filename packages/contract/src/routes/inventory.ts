/**
 * The pinned method+path inventory of the Corpus HTTP API — every endpoint
 * SPEC.md §9.2 lists, plus the queue and job verbs §7 requires, the
 * projection-maintenance pair behind §2.2's `corpus db rebuild` / `db doctor`,
 * and the validation route `POST /api/check`. That one was derived from a
 * behavioural section before §9.2 listed it (§14's "`corpus doc check` exposes
 * the same validator on demand"); the amendment CONTRACT-008 drafted for it is
 * signed off and applied — §9.2 now names it in its own bullet (SHARED-002).
 * Bullets are cited by the route they name, never by line number: §9.2 has been
 * amended repeatedly since, and a line reference here goes stale silently while
 * still reading as a checkable citation.
 *
 * CONTRACT-008's other half, `POST /api/skills/{name}/rollback`, is **gone**
 * (rider signed 2026-08-12): §7's loop safety is now a write whose content came
 * from history, performed through `PUT /api/docs/{id}` with a key, so the
 * inventory is the record that the endpoint is absent by decision rather than by
 * oversight.
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
 * /api/skills` was, and the derivation is worth stating even though §9.2 now
 * lists it. SPEC.md §4's edit-acknowledgment rider (signed 2026-08-02) names
 * the CLI verb — "a new CLI verb (`corpus doc diff <id>`) fetches the actual
 * diff on demand" — and the CLI is a thin HTTP client that performs no direct
 * file reads of git history (CLAUDE.md Architecture Decision 2), so the verb is
 * a server endpoint by construction. It sits immediately after
 * `GET /api/docs/{id}/related` because both are one-segment reads off a
 * document. The §9.2 bullet and the §7 "Core event types" clause for the
 * accompanying `doc.edited` type were drafted here and applied to SPEC.md by
 * the orchestrator, signed by the user 2026-08-05: this package never edits
 * SPEC.md itself.
 *
 * `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031) is the other half of
 * that same rider, and it is here because a premise stated in CONTRACT-028 was
 * measured and found false. §4 names two ends for a user edit session, one of
 * them "the reader closes (the UI flushes the session)"; CONTRACT-028 read that
 * flush as the release of §7's then-current edit lock and declared no endpoint
 * for it. SERVER-052 checked that against the shipped editor, which dropped the
 * lease on blur and after ten seconds of not typing against the session's three
 * minutes — so the lease always won and §4's explicitly "distinct and longer
 * window" would never be reached. (The lock itself is gone since SHARED-041; the
 * route it argued for is not.) A close signal of its own is therefore what the signed rider
 * requires, and §9.3 makes it a route declared here rather than one invented in
 * the server. It sits immediately after `GET /api/docs/{id}/diff` because those
 * two are §4's whole surface. Its §9.2 bullet was drafted here and applied by
 * the orchestrator, signed 2026-08-05, like the two above.
 *
 * `GET /api/upgrade/check` and `POST /api/upgrade` (CONTRACT-027) are derived
 * the same way, from SPEC.md §2.4's UI sentence (signed 2026-08-02, workspace
 * half 2026-08-03, applied 2026-08-05): "The UI offers the same flow on demand:
 * a check affordance, and when a newer release exists, an 'Upgrade & restart'
 * action that asks the server to spawn the detached CLI upgrade." A UI
 * affordance that *asks the server* is a server endpoint by construction, and
 * §9.3 makes it one declared here rather than invented in the server. Two
 * endpoints rather than one because §2.4 describes two acts and keeps them
 * apart — `corpus upgrade --check` "queries … compares … and reports", while
 * `corpus upgrade` installs — and the whole point of an on-demand posture is
 * being able to look without committing. §9.2 now lists both, in a bullet each,
 * in the order this inventory uses; the `POST /api/upgrade` bullet carries the
 * §2.4 rider's own sign-off date. The derivation stays recorded here because it
 * is why two routes exist where §2.4 describes one flow, not because either is
 * undocumented.
 *
 * `POST /api/threads/{id}/reattach` (CONTRACT-041) is derived from SPEC.md §6
 * rather than from §9.2, and the derivation is the whole issue. §6 guarantees
 * that an orphaned anchor is "still fully functional" and "never re-attached to
 * a lookalike", and SERVER-059 established that no reader can lift that
 * restriction: an anchor that never byte-matched is detached for the life of its
 * document, because reconciliation only ever carries an anchor forward or
 * orphans it. §6 therefore promises a state the corpus can enter and never
 * leave, which is a gap in the guarantee rather than a feature request — and the
 * only party holding the evidence is the person who wrote the comment, who can
 * reach the workspace only through the server (Architecture Decision 2). It sits
 * immediately after the resolve/reopen/seen group, which is where §9.2 puts its
 * bullet too — after the resolve/reopen/seen bullet, with the weight bullet
 * (signed the same day) between them, since that one is a clause about several
 * routes rather than an endpoint of its own. CONTRACT-041's drafted amendment
 * was signed by the user on 2026-08-08 and applied, together with the widening
 * of §9.2's acting-party clause to read "the user-only endpoints (deletion, and
 * re-attaching a thread) reject agent actors" — so the `403` is a spec rule
 * rather than a contract opinion. The derivation stays recorded here because it is why the route
 * exists, not because the route is undocumented.
 *
 * `POST /api/docs/bulk` (CONTRACT-037, reshaped by CONTRACT-048) is derived from
 * SPEC.md §4 rather than from §9.2, and the derivation is the whole issue. §4's
 * "One action, one commit" says an action a person takes on several documents at
 * once "lands as a **single** auto-commit" containing "exactly the documents the
 * action **changed**" — a *capability*, not a UI preference. Checked against the
 * code rather than assumed: every document mutation route declared above takes
 * one `{id}`, and the auto-committer's fold decision keys on the same document
 * and actor, so twenty archives of twenty different documents are twenty commits
 * by construction. §4 therefore presupposes a way to ask for several document
 * mutations as one act, and none existed; SHARED-017 made that check its own
 * final acceptance criterion and filed CONTRACT-037 first for exactly that
 * reason. SHARED-032 (signed 2026-08-09) then widened what has to be askable:
 * board selection became a **mode** in which each row carries its own staged
 * action, and §4 gained "**A Save carrying a mix of verbs is still one act and
 * still one commit**". So the route now takes a staged set of `{id, action}`
 * pairs plus §11's single whole-result-set entry, rather than one verb over many
 * ids — the same one endpoint, because grouping client-side by verb would be
 * several commits, which is what §4 forbids and what this route exists to
 * prevent. It sits immediately after `POST /api/docs` because it is the
 * collection's other mutation, and before the parameterised routes because a
 * static segment must be registered ahead of the parameter it shares a position
 * with. **This is the one entry §9.2 does not yet list**, and the only one: its
 * bullet is drafted in **CONTRACT-048's** issue file under "Held for sign-off"
 * and awaits the user's, so the derivation is recorded here to make the gap a
 * pending amendment rather than an undocumented route. CONTRACT-037's own held
 * draft described the `{ids, action}` shape and is **void** — its issue file says
 * so. Three §9.2 amendments were signed and applied on 2026-08-08 — the
 * re-attach route, the widening of the acting-party clause, and the weight
 * bullet — and this one was not among them; SHARED-032's sign-off on 2026-08-09
 * amended §4 and §11 and did not touch §9.2 either.
 *
 * `POST /api/docs/{id}/patch` (CONTRACT-046) needs no derivation at all, and
 * that is worth recording next to the entries above that did: SHARED-037 took it
 * to §9.2 as a rider **before** any of it was implemented, and the user signed it
 * on 2026-08-12, so the bullet existed before the route did. It is listed
 * immediately after `PUT /api/docs/{id}` because that is where §9.2's own bullet
 * order puts it. The rider was filed because PR #36's review caught this chain
 * citing "the patch operation" as spec text while §9.2 was silent about it — the
 * precedent that every user-observable behaviour reaches SPEC.md before it
 * reaches the code, which the re-attach route set and this one followed.
 *
 * `POST /api/threads/{id}/resident`, `DELETE /api/threads/{id}/resident` and
 * `GET /api/agents` (CONTRACT-051) are derived from SPEC.md §7 as amended by the
 * resident-agent rider (SHARED-043, signed 2026-08-13, corrected 2026-08-15),
 * and **§9.2 does not list them** — they join `POST /api/docs/bulk` as the
 * inventory's pending amendments rather than as undocumented routes. The
 * derivation, which is short because the rider is explicit: §7 says a standalone
 * thread "may designate a resident agent", that designation is "user-only state
 * on the thread, set and released like any other thread field", and that a
 * person "is released by the person who designated it" — a person reaches the
 * workspace only through the server (Architecture Decision 2), so setting and
 * releasing are each a server endpoint, and §9.3 makes them routes declared here
 * rather than invented in the server. The roster is derived the same way from
 * §7's "**Who is running is a read, never a push**: the roster and each lane's
 * liveness are read behind the ordinary invalidate keys, like any other
 * projection" — a *read* behind an invalidate key is an HTTP endpoint plus a
 * query key, and both halves are contract surface. No §9.2 bullet has been
 * drafted for them here: this package never edits SPEC.md, and the amendment is
 * the orchestrator's to take to the user.
 *
 * `GET /api/threads/{id}/scope` (CONTRACT-068) is derived from the same rider's
 * scope paragraph — "a resident owns a scope, not a thread", membership
 * "computed, never stored" — and from the user's request (2026-08-19) to see
 * "the designated agents as well as what documents / threads are attached to
 * their scope". A person reaches the workspace only through the server, so the
 * listing is an endpoint, and §9.3 makes it a route declared here. Like the
 * three above, **§9.2 does not list it yet**: it joins the pending amendments
 * rather than the undocumented, and the bullet is the orchestrator's to draft.
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
  "POST /api/docs/bulk",
  "GET /api/docs/{id}",
  "GET /api/docs/{id}/related",
  "GET /api/docs/{id}/diff",
  "POST /api/docs/{id}/edit-session/flush",
  "PUT /api/docs/{id}",
  "POST /api/docs/{id}/patch",
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
  "GET /api/threads/{id}/scope",
  "POST /api/threads/{id}/turns",
  "DELETE /api/threads/{id}/turns/{ts}",
  "POST /api/threads/{id}/turns/{ts}/form",
  "POST /api/threads/{id}/resolve",
  "POST /api/threads/{id}/reopen",
  "POST /api/threads/{id}/seen",
  "POST /api/threads/{id}/reattach",
  "POST /api/threads/{id}/resident",
  "DELETE /api/threads/{id}/resident",

  "GET /api/agents",

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

  "GET /api/upgrade/check",
  "POST /api/upgrade",

  "GET /events",
  "GET /attachments/{path}",
] as const;

export type EndpointSignature = (typeof ENDPOINT_INVENTORY)[number];

/** `GET /api/docs` — the spelling both the inventory and the generated document use. */
export const endpointSignature = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path}`;
