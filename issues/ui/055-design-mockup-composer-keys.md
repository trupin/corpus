# [UI-055] The design mockup still shows and binds the old composer keys

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-052
- Blocks: —

## Spec References
- SPEC.md §11 composer key contract (SHARED-009 Amendment 1, signed 2026-08-03)

## Summary
Noted by UI-052 and deliberately left alone: `design/index.html` — the living UI
mockup, authoritative for look and feel — still shows `Reply ↵`, `Ask ↵`,
`Capture ⌘↵` and `⇧↵ newline`, and its prototype JavaScript still binds those
keys. The amended §11 supersedes it, so the app is right and the mockup is stale.

Left out of UI-052 because several agents were working in the tree and rebinding
prototype JS is an unrelated chore. It matters because the mockup is what gets
consulted for "how should this look" — a stale key label there will be copied
into something eventually.

## Acceptance Criteria
- [x] Labels updated: `Reply ⌘↵`, `Ask ⌘↵`, `Capture ⇧⌘↵`, and the hint reads
      `↵ newline`. **There is no `Comment ⌘↵` label to update**: the mockup's
      selection toolbar creates the thread directly (`💬 Comment` → a card), so
      it has no comment composer and no send key of its own. Nothing was invented
      to match the app
- [x] The prototype's key bindings match the contract (`↵` newline, `⌘↵` primary,
      `⇧⌘↵` secondary)
- [x] The mockup's composer fields are multi-line where the app's now are, so the
      mockup does not disagree about the shape either
- [x] Nothing else in the mockup changes

## Technical Design
### Files to Create/Modify
- `design/index.html`

## Testing Strategy
Visual check; the mockup carries no test suite.

## E2E Verification Log

**Model: Opus 5 (1M context).** The mockup carries no test suite, so this is a
read of the file and of the prototype's own behaviour.

### Labels

```
design/index.html:559   <span class="hint">@ agents · / skills · [[ refs · ↵ newline</span>
design/index.html:561   …>Capture ⇧⌘↵</button>
design/index.html:562   …>Ask ⌘↵</button>
design/index.html:1033  <button class="send" data-send="${tid}">Reply ⌘↵</button>
```

`grep` for the old strings (`Reply ↵`, `Ask ↵`, `Capture ⌘↵`, `⇧↵ newline`)
returns nothing.

### Bindings

`#compose-text`'s handler now returns early unless `⌘`/`Ctrl` is held — so a bare
`↵` inserts a newline like any other key — and picks Capture on `⇧⌘↵`, Ask on
`⌘↵`. The reply box had **no** handler at all (it was an `<input>`, so `↵` did
nothing); it gets a delegated one, because the cards are re-rendered from
`threadCardHTML`, that clicks `[data-send]` on `⌘↵` and leaves `↵` alone.

### Shape

The reply field is a `<textarea rows="2">` where it was an `<input>`, with
`.composer textarea` replacing `.composer input` in the stylesheet (`resize:
none`, `min-height: 2.6em`). The two places the prototype reached for that field
by tag — the `r` shortcut's focus target and the post-comment focus — follow it.
`#compose-text` was already a textarea.

`prettier --check design/index.html` passes.

### Left deliberately

The mockup still draws the 💬 button and its `.comments-pop`, which UI-063 has
just replaced in the app with a `Document / Comments` toggle and a comments tab.
That is outside this issue's "nothing else in the mockup changes" and is reported
to the orchestrator as a follow-up rather than folded in here.

## Completion Checklist (domain agent)
- [x] `/lint` passes (prettier covers the file)
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
