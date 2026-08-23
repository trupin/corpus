# [CLI-057] `doc show` takes one id, so reading five documents costs five processes

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Related: CLI-058 (the per-invocation cost this multiplies), CLI-055

## Spec References
- SPEC.md **§2** — the CLI surface

## Summary

Reported from live use, 2026-08-21. `corpus doc show a b` is refused.

Accepting several ids replaces five calls with one and saves roughly **840ms**
each time. The reporter's reasoning is worth keeping: *"Returning more rows is
free next to the cost of asking, since latency is flat against payload."* That
is the same observation behind CLI-058, measured from the other end.

## Decisions to make and record

1. **What the output looks like for several documents.** `--json` should be an
   array; the human rendering needs a separator that a reader can scan and that
   a `sed` script cannot mistake for content.
2. **What happens when one id of five does not exist.** Failing the whole call
   punishes the four that were fine. Reporting per id is friendlier and needs an
   exit code that says "partial" honestly rather than 0.
3. **Whether a bound is needed**, and if so, whether exceeding it truncates or
   refuses. §10's stated-cap rule says a listing that reached its bound must say
   so rather than ending quietly, and the same principle applies here.
4. **Whether the same shape belongs on `thread show`.** Do not build it here
   without at least saying why the other verb is different.

## Decisions taken

### 1. Several documents print under a rule that carries the id; `--json` is an array

Human mode puts `──────── <id> ────────` above each document and renders each
one exactly as a single-id read would. The rule carries the id so that something
other than an eye can use it — `sed -n '/^──── doc_a1b2c3 /,/^────/p'` cuts one
document out of the stream — and it is drawn with `U+2500` rather than `-` or
`=` because a markdown body may open a line with either of those (`---` is both
a frontmatter fence and a setext underline). **No separator character can be
guaranteed absent from a body**, and the help says the honest thing: a caller
that needs certainty uses `--json`, where the documents are array elements and
no parsing happens at all.

`--json` emits a JSON array of the same payloads a single-id read emits, in the
order asked for. *Rejected: an array of `{id, found, doc?, error?}` envelopes.*
It would make a miss self-describing, but it changes the element shape, so a
caller iterating the array has to unwrap every element to serve the one that
failed. The misses travel on the failure envelope instead, which is where this
CLI already puts what went wrong, and each element's `.frontmatter.id` names it.

**A repeated id is read once and printed once.** Naming a document twice never
means "print it twice under two rules".

### 2. A missing id costs the caller that id and nothing else

Every document that was found is printed. The misses are named together
afterwards on stderr, with `details.missing` and `details.found` so a machine
caller recovers without a second request. **Any other failure ends the run where
it happens** — a `401` or an unreachable server is a fact about the run rather
than about one id, and pressing on would spend up to 199 more doomed round trips
before saying so.

### 3. The exit code is 5 for partial, 0 for all-found — deliberately not a new code

Exit 0 means every id was found; exit 5 means at least one was not. That is the
distinction the issue asked for, and it is spelled with the code a *single*
missing id has always produced (`404 not_found`), so a caller's branch on the
exit status does not have to know how many ids it sent.

*Rejected: `partialFailure` (exit 8).* Its documented meaning is "something had
already been changed, so verify before retrying", and this is a read that changed
nothing. *Rejected: `RefusedError` (exit 7)*, which asserts nothing happened —
three documents were printed. Exit codes in this CLI group by what the caller does
next, and after a partial read the next move is "fix the ids", which is what a
`404` already says.

### 4. The cap is 200, refused before any request

`MAX_PAGE_LIMIT` from the contract, not a number invented here: the most
documents one read may name is the most rows one listing may return. Exceeding it
is exit 2 with the cap stated (§10's stated-cap rule) — a bounded read that
quietly dropped the ids past the bound would be the silent half-answer that rule
exists to forbid, and 200 sequential round trips is already ~2 s.

### 5. `--headings` and `--section` take one id, and refuse several

Both read *inside* one document. `--section`'s entire value is that its output is
the document's own bytes, and two sections joined by any separator are no longer
either document's bytes; `--headings`' value is a list that pastes straight back
into `--section`, and a list that has to be attributed to a document first is a
list the caller has to take apart. Several ids with either flag is exit 2 before
any request.

### 6. The requests are sequential, one at a time

Concurrency would collapse five round trips into roughly one, but that is a
second-order gain — some 40 ms against the 608 ms the shared startup already
recovers — bought with a failure mode that has to be got right: which of several
in-flight failures ends the run, and what has already been printed when one does.
Sequential keeps "printed in the order asked for" true by construction and keeps
each id's failure exactly the failure a single-id call would have raised.

### 7. `thread show` does not get the same shape, and here is why

The issue asked for a reason rather than a second implementation. `doc show` is
read in **bulk and by id** — `corpus doc list`, `corpus search` and a board's
`columns` all hand back id lists, and the agent's next move is to read several of
them. `corpus thread show` is not reached that way: a thread arrives one at a
time from a claimed queue event, and the verb that reads several conversations at
once already exists and is not this one — `corpus thread context` assembles the
pack for one thread, and `corpus queue claim-all` returns the set. Adding a
plural form to `thread show` would be a shape with no caller. If one appears, the
argument here transfers whole and the change is small.

## Acceptance Criteria
- [x] `doc show a b c` returns all three
- [x] `--json` is an array, stable in the order asked for
- [x] A missing id among present ones is reported per id, not by failing all
- [x] The exit code distinguishes all-found from partial (0 against 5)
- [x] One id still behaves exactly as it does today — no output change


## Testing Strategy
Unit over the multi-id path including the partial case. One end-to-end read of
three real documents.

## E2E Verification Log

**Model: Opus 5 (1M context) — `claude-opus-5[1m]`.** Date 2026-08-23.

Packaged bundle (`npm run package:build`) against a real daemonized server on
port **8931** in a scratch workspace — the user's server on 8765 was never
touched. Five real documents, `doc_xwtmg6ph … doc_nemhncib`.

### Before the fix — reproduced against the installed v0.19.0

```
$ corpus doc show doc_xwtmg6ph doc_j7rh2slj
corpus: unexpected argument "doc_j7rh2slj" for "show".
  Usage: show <id> [flags]
exit=2
```

### The measurement, re-measured rather than assumed

Machine quiet (load average 3 — under load average 71 the same pair measured
1,050 ms against 261 ms, which is why every figure here is a minimum of 15
interleaved runs):

```
five separate `corpus doc show <id>`  min   796.6  med   815.6 ms
one `corpus doc show a b c d e`       min   189.0  med   190.8 ms
saving                                min   607.5  (4.2x)
```

**608 ms saved on one read of five documents.** The issue projected ~840 ms from
a 210 ms per-call cost; the honest figure is 608 ms, because the per-call cost is
~159 ms on this machine (CLI-058) and one call still makes five round trips.

### After the fix

```
$ corpus doc show doc_xwtmg6ph doc_j7rh2slj
──────── doc_xwtmg6ph ────────
Note one
doc_xwtmg6ph · note · open
key d075b8e92614d866a1dc25af09f151cb7ab82773de55822281723adb3b43a961
data/docs/inbox/note-one.md
created 2026-08-23T16:50:45Z · updated 2026-08-23T16:50:45Z
tags —

Body of one.

──────── doc_j7rh2slj ────────
Note two
…
```

**`--json` is an array, in the order asked for** — not id order, not creation
order:

```
$ corpus doc show doc_nemhncib doc_xwtmg6ph doc_ebusklfs --json | …
list 3
  doc_nemhncib Note five 'Body of five.\n'
  doc_xwtmg6ph Note one 'Body of one.\n'
  doc_ebusklfs Note three 'Body of three.\n'
```

**One id is unchanged — an object, not a one-element array, and no rule:**

```
$ corpus doc show doc_xwtmg6ph --json | …
dict ['anchors', 'body', 'frontmatter', 'key', 'path', 'userEditing']
```

### A missing id among present ones

```
$ corpus doc show doc_xwtmg6ph doc_nosuchdocid doc_j7rh2slj
──────── doc_xwtmg6ph ────────
Note one
──────── doc_j7rh2slj ────────
Note two
# stderr:
corpus: 404 not_found: 1 id names no document — doc_nosuchdocid.
  The other 2 documents were read and printed; only the ids above are missing.
  {
    "missing": [ "doc_nosuchdocid" ],
    "found": [ "doc_xwtmg6ph", "doc_j7rh2slj" ]
  }
exit=5
```

Under `--json`, stdout still carries the array of what was found and stderr
carries the envelope — `--json`'s "exactly one JSON value on stdout" holds:

```
$ corpus doc show doc_xwtmg6ph doc_nosuchdocid --json
# stdout: array of 1 -> ['doc_xwtmg6ph']
# stderr: {"error":{"code":"not_found","message":"404 not_found: 1 id names no document — doc_nosuchdocid.",
#          "hint":"The other document was read and printed; only the ids above are missing.",
#          "details":{"missing":["doc_nosuchdocid"],"found":["doc_xwtmg6ph"]}}}
exit=5
```

Every id missing says so differently, and prints nothing:

```
$ corpus doc show doc_nosuch1 doc_nosuch2
corpus: 404 not_found: 2 ids name no document — doc_nosuch1, doc_nosuch2.
  None of the ids named a document, so nothing was printed. `corpus doc list` and `corpus search` are where an id comes from.
exit=5
```

### The refusals, all before any request

```
$ corpus doc show doc_xwtmg6ph doc_j7rh2slj --headings
corpus: --headings reads inside one document, so it takes one id — 2 were given.
  Name the one document you want to read into. Several ids without these flags reads each document whole, which is what they are for. Nothing was requested.
exit=2

$ corpus doc show doc_xwtmg6ph doc_j7rh2slj --section "Note one"
corpus: --section reads inside one document, so it takes one id — 2 were given.
exit=2

$ corpus doc show <201 ids>
corpus: at most 200 documents can be read in one call, and 201 ids were given.
  Nothing was requested. Read them in batches of that size, or narrow the set first with `corpus doc list` or `corpus search`.
exit=2

$ corpus doc show doc_xwtmg6ph --headings   # one id keeps both flags
Note one
exit=0
```

A repeated id is read once: `corpus doc show a b a` printed **2** rules.

### Falsification — the fix broken three ways on purpose

Each break was made in `show.ts`, the scoped suite run, then restored.

| break | tests that failed |
|---|---|
| a `404` aborts the whole call instead of being collected | "prints the documents it found and names only the ids it did not"; "still emits the array of what it found under `--json` when one id is missing" |
| the repeat is not dropped (`new Set` removed) | "reads a repeated id once and prints it once" |
| the ids are sorted before they are read | "reads each id, in the order asked for, one request each"; "emits a JSON array in the order asked for" |

Restored, 45 passed. **No test in this file passes with the fix absent**: the
whole `several ids` block calls `runDocShow` with an array argument, which the
previous implementation could not accept at all.

### Checks

- `npx vitest run apps/cli` — 2,015 passed, 104 files. Scoped runs only,
  `VITEST_MAX_THREADS=4`.
- `eslint apps/cli/src apps/cli/scripts` — clean, no rule disabled anywhere.
- `prettier --check apps/cli/src docs/cli.md` — clean.
- `tsc --noEmit -p apps/cli/tsconfig.json` — clean.
- `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`;
  `docs/generate.test.ts` green.
- Test server on 8931 stopped; port 8765 never touched.
