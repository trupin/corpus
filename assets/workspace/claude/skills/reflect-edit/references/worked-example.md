# Reflecting on a user edit — worked end to end

The reflect-edit skill's body carries the procedure; this file walks one real
`doc.edited` through it — the read, the judgment, the ripple, the update and both
entries. Read it when the procedure's shape is unclear, never as part of an ordinary
reflection.

**Worked, end to end.** The person edited a mortgage note; the reflection finds one document
that copied the old figure and fixes it.

```bash
corpus job log evt_7c1d9a "claimed doc.edited on [[doc_a1b2c3]] (1 commit, +2 -2, ended by idle)"
corpus doc diff doc_a1b2c3 --from-rev 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b --to-rev 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
doc_a1b2c3 · data/docs/finance/mortgage-options.md
0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b..9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
1 commit · +2 -2 · 268 characters

@@ -3,7 +3,7 @@
-The working rate assumption is 6.1% as of 2026-05-02.
+The working rate assumption is 6.4% as of 2026-07-28.
```

A number changed, so it is substantive; the claim that changed is the rate assumption, so
that is what the two lookups ask about:

```bash
corpus doc related doc_a1b2c3 --limit 5
doc_7e3a91  linked  Refinance plan — every projection here assumes 6.1% for the whole term
corpus search "rate assumption 6.1%" --limit 5
doc_7e3a91  Refinance plan › Costs  …every projection here assumes 6.1% for the whole term…
corpus doc show doc_7e3a91
key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa
```

One document, one figure, one way to write the new one — mechanical and entailed, so it is
an update rather than a question. That last read is the one the write is written against, so
its key goes straight into the edit. The update carries its own entry, because with no thread
opened anywhere nothing else would tell a reader of that document why its figure moved:

```bash
corpus doc edit doc_7e3a91 --key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa --from agent <<'CORPUS_EOF'
# Refinance plan

Every projection here assumes 6.4% for the whole term, following the rate
assumption in [[doc_a1b2c3]].

## Changelog

- **2026-07-28** — carried the working rate assumption from 6.1% to 6.4%, following the
  correction in [[doc_a1b2c3]]. Every projection here reads that one figure, so the change
  is arithmetic and takes no decision.
CORPUS_EOF
edited doc_7e3a91
key 401056da72e89508679079c53bb06a0f4db1601033ed1d3139545d83119f7895
corpus job log evt_7c1d9a "edited [[doc_7e3a91]] — carried the 6.4% rate assumption across"
```

That write replaced a whole body — one figure changed and the section it now carries did not
exist — so it presented a key, and it printed a fresh one, which is what any further edit to
`doc_7e3a91` would present with no second read. The entry on the edited document itself is a
different document, so it takes its own read, and it is an append at the end of a body: the
key rather than a quote, the July 14th entry passed back through untouched.

```bash
corpus doc show doc_a1b2c3
key 028ee5455198acebc06757dee3a14c12d0009a271ebf5131fc33c7e2c4778d70
corpus doc edit doc_a1b2c3 --key 028ee5455198acebc06757dee3a14c12d0009a271ebf5131fc33c7e2c4778d70 --from agent <<'CORPUS_EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28.

## Changelog

- **2026-07-14** — replaced last year's lender table with this year's. Nothing else in the
  corpus quoted those figures.
- **2026-07-28** — the working rate assumption moved from 6.1% to 6.4%. [[doc_7e3a91]]
  projected the whole term at the old figure and I carried the new one across; nothing else
  quotes it, and nothing here needs a decision from you.
CORPUS_EOF
edited doc_a1b2c3
key 5c0f2a7d18e6b4930c1d8f27a6b5430e9f8c72d1a04b6e35f9c2807d61a34be8
corpus job log evt_7c1d9a "completed — logged the change on [[doc_a1b2c3]], no thread opened"
corpus queue complete evt_7c1d9a
```
