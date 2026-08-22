# [SHARED-063] §10's reader menu offers Resolve "for threads", and every document has one

## Domain
shared (orchestrator)

## Status
done — **SIGNED by the user 2026-08-22**, applied to SPEC.md §10 the same day

## Priority
P1

## Model
fable

## Dependencies
- Related: SHARED-031 (which settled the vocabulary), UI-094 (which implemented it)

## Spec References
- SPEC.md **§10** — the reader ⋯ menu
- SPEC.md **§5** — the status ladder

## Why it was needed

Found by PR #55's cold reviewer, as a MAJOR. SHARED-031 settled that `status` is
**one vocabulary and not a per-type one**, and UI-094 made the menus agree with
the frontmatter form — which had been offering `open`/`resolved` on an ordinary
note all along while both menus withheld it.

The substance was already signed. **The sentence was not.** §10's enumeration
still read *"Resolve/Reopen for threads"*, so the spec described the menu's old
contents and the code no longer matched it.

## The signed text

§10's reader ⋯ menu sentence now reads:

> A reader **⋯ menu** offers Archive, Unarchive (archived documents), **Delete**
> (user-only, explicit confirm per §9), and **Resolve/Reopen on every document
> whose status is its own to set** — §5's ladder is one vocabulary and not a
> per-type one, so a note answers it as a thread does. A document whose type
> **derives** its status offers neither, because there is nothing there for
> anyone to set. Resolve/reopen also sits on every thread card.

## The call, and what it rejected

**Chosen: amend the sentence to match SHARED-031.**

**Rejected: revert UI-094 and take Resolve back off document rows.** That
restores the state UI-094 measured: a person could resolve a note from the
frontmatter form but from neither menu, while §10 says a context menu lists
*"exactly that item's existing actions"*. SHARED-031 says the form is the one
that is right, so reverting would have preserved the sentence by keeping a
contradiction the same rider already settled.

**The derived clause is not new behaviour** — it records what UI-094 built on
SHARED-031 part 2's existing signed text, *"it offers no Resolve, because there
is nothing there for anyone to set"*, so a reader of §10 alone reaches the same
answer as a reader of §5 and §12.

## Acceptance
Signed and applied to SPEC.md §10 on 2026-08-22.
