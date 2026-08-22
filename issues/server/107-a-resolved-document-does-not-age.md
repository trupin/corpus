# [SERVER-107] A resolved document does not age — and the ramp never heard about it

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: SHARED-031 (the status ladder rider, signed 2026-08-12), SERVER-108
  (the other half of the same rider that the code never received)

## Spec References

- SPEC.md **§5** — "a `resolved` or `archived` document does not age, because the
  ramp asks whether something still needs attention and that document has
  answered (§5's status ladder), which is **a second exemption beside
  `evergreen`** rather than a replacement for it"
- SPEC.md **§5** (status ladder) — "Because nothing further is required of it, a
  resolved document **does not age**, and leaves the stale set if it was already
  in it"
- SPEC.md **§5** (frontmatter) — `evergreen: false # true = never considered
  stale (reference material); a resolved doc never ages either`
- SPEC.md **§9.2** — "`needs=stale` answers for `open` documents only — a
  `resolved` or `archived` document does not age (§5), so it is not stale and
  **never enters the union on that reason**"
- SPEC.md **§10** — the staleness ramp (age rail → dimming → age chip →
  archive-or-act), rendered per row from `DocRow.stale`

## Summary

The claim is in SPEC.md in five places, in two of them as a **route-level
guarantee**, and it is implemented nowhere. `apps/server/src/docs/staleness.ts:50`
is the whole of the ramp's predicate and carries no status term:

```ts
`(d.evergreen = 0 AND ${ACTIVITY_SQL} <> '' AND ${ACTIVITY_SQL} <= @cutoff_${tierParam(tier)})`;
```

There is exactly one exemption — `evergreen` — where §5 promises two. Because
that one function is what the `stale=` filter pushes (`filters.ts:295`), what
`needs=stale` is (`needs.ts:153`, and therefore what `needs=me` ORs into
`ANY_REASON_SQL`), and what `DocRow.stale` reports (`STALE_TIER_SQL`, selected by
`query.ts:178`), **all four surfaces are wrong in the same direction at once**: a
document that answered the ramp's question keeps being asked it.

Nothing else is at fault. `filters.ts:116` excludes only `archived` by default and
never `resolved` — correctly, since §5 says a resolved document keeps its place in
every list; the point is not that it should disappear, it is that it should stop
carrying a reason it has already answered.

Found in PR #44's third review as a **CRITICAL**: the reviewer had propagated the
rider's text into §9.2 and §5 without checking that the write path delivered it.

## Reproduction

Logged in full in the E2E Verification Log below. In one line: three aged
documents (`open`, `resolved`, `archived`, all last touched 2025-01-02) are
returned by `needs=stale`, by `needs=me` and by `stale=aging`, each carrying
`stale: "very-stale"` and `attention: ["stale"]`.

## Decision

**Implement the claim; do not retract it.** The user chose to propagate it
(SHARED-031, signed 2026-08-12) and the reasoning behind it stands: the ramp asks
whether something still needs attention and a resolved document has answered.
§5's own text records that the trade — a document resolved years ago that
genuinely wants re-reading is never re-offered — was accepted deliberately.

## Acceptance Criteria

- [x] `atOrBeyondSql` carries a `status` term, so a document that is not `open`
      is never at or beyond any tier
- [x] Both statuses, not just `resolved` — §9.2 names `resolved` **and**
      `archived`
- [x] `GET /api/docs?needs=stale` returns `open` documents only
- [x] `needs=me` does not admit a row on the `stale` reason alone when the row is
      `resolved` or `archived` (§9.2's "never enters the union on that reason")
- [x] `stale=aging|stale|very-stale` returns `open` documents only, with
      `includeArchived=true` too — widening the archived default must not widen
      the ramp
- [x] `DocRow.stale` reads `null` for a `resolved` or `archived` row whatever its
      dates say — the §10 ramp is rendered from that column, so the chip and the
      filter have to agree
- [x] Resolving a document that was already stale **removes** it from the stale
      set on the next read (§5: "leaves the stale set if it was already in it")
- [x] Reopening it puts it back, without any dates being rewritten
- [x] `evergreen` still works and is still a separate exemption — a `resolved`
      document is exempt whether or not it is evergreen, and an `open` evergreen
      one stays exempt

## Technical Design

### The single change

`apps/server/src/docs/staleness.ts` — add `d.status = 'open'` to
`atOrBeyondSql`. That function is deliberately the only place the ramp is
expressed: the filter, the Attention reason and the row's tier are all composed
from it (the module header already argues this, and `staleness.test.ts` pins the
composition), so one term reaches all four surfaces and no second copy can drift.

Spelled positively (`= 'open'`) rather than as a pair of negations
(`<> 'resolved' AND <> 'archived'`): §5's ramp is defined **for open documents**,
and a status enum that ever grows should default to not ageing rather than to
ageing.

### Files to Create/Modify

- `apps/server/src/docs/staleness.ts` — the term, plus the comment that says why
  there are now two exemptions and not one
- `apps/server/src/docs/staleness.test.ts` — extend the conjunct pin rather than
  loosening it; add a case that fails without the term
- Wherever a fixture relies on a non-`open` document being stale

### What is deliberately not changed

- `filters.ts`'s archived default. §5 keeps a resolved document in every list;
  the ramp is what stops, not the visibility.
- The thresholds, the tier order, and `ACTIVITY_SQL`. A resolved document's
  `updated` is still stamped and still read — it simply reaches no tier.

## Testing Strategy

- `staleness.test.ts` — the predicate names all four conjuncts, in the order it
  builds them; a `STALE_TIER_SQL` case showing the status term is inside every
  `WHEN`, since the tier is composed from the same fragment.
- `docs/query.test.ts` (or the collection-query test that owns the ramp) — real
  rows through a real projection: an aged `open` row is stale and carries the
  reason; the same row `resolved`, and again `archived`, reads `stale: null` with
  no `stale` in `attention`, and is absent from `needs=stale`, from `needs=me`
  and from `stale=aging` — the archived one with `includeArchived=true` so the
  test cannot pass merely because the default excluded it.
- A resolve-then-read case, because §5 promises the document *leaves* a set it was
  already in.

## E2E Verification Plan

Real server against a real workspace on a scratch port. Seed aged documents in
all three statuses and query the four surfaces before and after the fix. Then
watch one leave and re-enter the stale set — noting that a `PUT` round trip
cannot show the re-entry, because resolving stamps `updated` and the document
becomes genuinely fresh; the status has to be flipped out of band, with the dates
left alone, for the exemption to be what is being observed.

## E2E Verification Log

Implemented on: **opus**.

Scratch workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/wsA`, real
`corpus server start` on port **8791** (never 8765 — that is the user's live
server). Three documents seeded out of band, all with
`updated: 2025-01-02T09:00:00Z` (~587 days before now) and `evergreen: false`,
differing only in `status`; the watcher projected them.

### Reproduction (pre-fix, build of commit `ok4c58f8a5`)

```
== needs=stale (default: archived excluded) ==
doc_oldopen1 | open     | very-stale | ["stale"]
doc_oldres01 | resolved | very-stale | ["stale"]

== needs=stale&includeArchived=true ==
doc_oldarc01 | archived | very-stale | ["stale"]
doc_oldopen1 | open     | very-stale | ["stale"]
doc_oldres01 | resolved | very-stale | ["stale"]

== needs=me&includeArchived=true ==
doc_oldarc01 | archived | very-stale | ["stale"]
doc_oldopen1 | open     | very-stale | ["stale"]
doc_oldres01 | resolved | very-stale | ["stale"]

== stale=aging&includeArchived=true ==
doc_oldarc01 | archived | very-stale
doc_oldopen1 | open     | very-stale
doc_oldres01 | resolved | very-stale
```

(columns: `id | status | DocRow.stale | attention`)

All four surfaces wrong at once, in both the filter and the reported tier — the
row §9.2 and §10 promise cannot appear, appearing on every one of them.

### Post-fix

Rebuilt (`npm run build`), server stopped and started on the same workspace so
the fix is in the running process, then the same four queries:

```
-- needs=stale
   doc_oldopen1 | open | stale=very-stale | ["stale"]
-- needs=stale&includeArchived=true
   doc_oldopen1 | open | stale=very-stale | ["stale"]
-- needs=me&includeArchived=true
   doc_oldopen1 | open | stale=very-stale | ["stale"]
-- stale=aging&includeArchived=true
   doc_oldopen1 | open | stale=very-stale | ["stale"]

-- every seeded row as the board reads it (GET /api/docs?includeArchived=true)
   doc_oldarc01 | archived | stale=null       | []
   doc_oldopen1 | open     | stale=very-stale | ["stale"]
   doc_oldres01 | resolved | stale=null       | []
```

The archived row's absence is the ramp's doing and not the default result set's:
it is absent from `includeArchived=true` too, and present in the last listing —
where it reads `stale=null` with no reason. §10's chip and §9.2's filter agree,
because they are the same fragment.

### Leaving and re-entering the stale set

**Through the real routes, `PUT` cannot show the second half, and that is
correct**: resolving stamps `updated`, so reopening yields a genuinely fresh
document rather than a stale one.

```
PUT doc_oldopen1 {status:"resolved"} -> 200 ; needs=stale=[]        ; stale=null
PUT doc_oldopen1 {status:"open"}     -> 200 ; needs=stale=[]        ; stale=null
                                            (`updated` is now, so it is fresh)
```

So re-entry was shown the way it actually happens — an out-of-band status edit
that leaves the dates alone, projected by the watcher:

```
$ sed -i '' 's/^status: resolved/status: open/' data/docs/old-resolved.md
  needs=stale -> doc_oldres01:very-stale:open   (its `updated:` still 2025-01-02T09:00:00Z)

$ sed -i '' 's/^status: open/status: resolved/' data/docs/old-resolved.md
  needs=stale -> (empty)
  needs=me    -> (empty)
```

No date was rewritten in either direction — the row's age is untouched and simply
no longer consulted, which is what makes §5's "leaves the stale set if it was
already in it" a reading of the row rather than a rewrite of it.

### The two exemptions are independent

A fourth and fifth document, seeded the same way, with all five read in one
response:

```
doc_oldopen2 | open     | evergreen=false | stale=very-stale | ["stale"]
doc_oldres01 | resolved | evergreen=false | stale=null       | []
doc_oldarc01 | archived | evergreen=false | stale=null       | []
doc_oldever01| open     | evergreen=true  | stale=null       | []
needs=stale -> doc_oldopen2
```

An open, non-evergreen, 587-day-old document still ages; an open evergreen one
still does not. (`doc_oldopen1` is absent from this snapshot as genuinely fresh:
the `PUT` round trip above restamped its `updated`.)

### Checks

- `npm run build` — green
- `npx vitest run apps/server` (`VITEST_MAX_THREADS=4`) — 179 files, 3755 tests,
  all passing, including the 4 new behavioral cases and the 2 new predicate cases
- The new cases were confirmed to **fail** with the status term removed and to
  pass with it — 4 failed / 115 skipped when the term is taken out
- `npx eslint` and `npx prettier --check` on every touched file — clean;
  `tsc --noEmit` in `apps/server` — clean

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
