# [SHARED-064] SPEC riders for the navigation model: explorer, boards as documents, paths, kanban graphs

## Domain
shared (orchestrator-handled)

## Status
done

## Priority
P0

## Model
fable — every rider is a judgment about the product's direction, read back to the user one at a time for signature.

## Dependencies
- Depends on: —
- Blocks: CONTRACT-074, CONTRACT-075, AGENT-042 (and through them the whole of Phase 41)

## Spec References
- SPEC.md §2.4 — "Upgrading"
- SPEC.md §5 — "The document model" (the status ladder)
- SPEC.md §9.2 — "HTTP API"
- SPEC.md §11 — "UI — the board"

## Summary
Phase 41 replaces the board's navigation model. SPEC §11 today says "No sidebar", "a column IS a `type: view` document with `pinned: true` … and `order`", "clicking a row opens the document _in that column_ (column widens)", and focus mode is the only full-width surface. The prototype at `design/navigation.html` (agreed with the user on 2026-08-22, clickable copy published as an artifact) replaces those sentences with: a retractable explorer, boards that are `type: board` documents, paths of reader columns that open to the right of the row they came from, a column strip, kanban boards over a field with a transition graph, and `stage` as a core field beside `status`. This issue writes those riders into SPEC.md and gets each one signed. Nothing downstream starts before its rider is signed, because every other issue in the phase cites the rider text.

## Acceptance Criteria
- [x] Each rider below is in SPEC.md, marked `_(Rider signed <date>.)_`, after the user signed it on the quoted text — one rider per exchange, never batched (memory: a batched read-back hid a live §4/§7 contradiction once).
- [x] §11's "Visual reference" line names `design/navigation.html` as authoritative for navigation look and feel, beside `design/index.html` for everything else.
- [x] No sentence in §11 still says "No sidebar", "pinned: true", "column widens", or "order (board position)" about a view.
- [x] §9.2's `GET /api/docs` line no longer lists `pinned=`, and lists `stage=`.
- [x] §5 carries `stage` in the canonical frontmatter and the coupling rule.
- [x] §2.4 says an upgrade reports data migrations as commands.
- [x] §7 carries `workspace.reflect`, the quiet window, the clock and the digest thread (rider 9).

## Technical Design

### Files to Create/Modify
- `SPEC.md` — the riders below
- `design/navigation.html` — already written; commit it with this issue

### The riders, in signing order

**Rider 1 — §11, the explorer (replaces "No sidebar").**
> **The explorer.** A retractable panel at the left edge of the board shows the workspace as a tree: `GET /api/tree`'s folders, and under each folder its documents. It retracts horizontally, the way the console retracts vertically, remembers its width and its open state browser-locally, and is closed by default. A click on a document opens it on the board that receives the explorer's opens (below); a double click keeps it; a right click offers the document's existing actions and a choice of board. A folder's menu offers the folder acts of §9.2. A document already open on the current board shows a mark in the tree. Archived documents stay in the tree, marked. A `type: board` document in the tree **is the board**: clicking it shows that board, restoring it first if it was archived.

**Rider 2 — §11, boards are documents (replaces "Columns are pinned view documents").**
> **A board is a `type: board` document.** Its frontmatter lists its columns — the ids of `type: view` documents, in order — and its `order` among boards. A view document is a saved query and nothing more: it has no `pinned` and no `order`, and the same view may sit on two boards. Adding, removing or reordering a column edits the board document; reordering boards writes `order` on every board, in one commit. The agent builds a board the way it builds any document. At most one board carries `default-open: true`; setting it on one clears the others, and the response names the documents it changed (§9.2). **One board is always showing**: archiving the last board is refused. A board's lifecycle is its document's: archive, restore, rename and delete act on the file. The board bar above the board lists the boards in `order`; its tabs drag to reorder. The seed ships three boards — Attention, a kanban over `status`, and Files — and no board is hardwired.

**Rider 3 — §11, paths (replaces "Clicking a row opens the document _in that column_ (column widens)").**
> **A row opens a path.** Clicking a row opens the document in a new column directly to the right of the row's column; the columns after it move right. The row stays highlighted as the path's **origin** while the path is open. A link followed inside a path column continues the path to the right. A path is a chain: picking a new row from the origin replaces the whole path, picking a link from a column mid-path replaces everything to its right. **No document appears twice in one path**: opening a document already in the path scrolls to its column and closes nothing. "Open here" (the row's menu, or `⌥↵`) opens the document in the column itself, pushing onto that column's own navigation stack, which is the reader the column always had. From any path column a person may **restart the path here** (the path closes and the document becomes the root of a loose path in the same place) or open a **new path to the right**. A **loose path** is a path with no origin row; an open with no origin — the search overlay's `↵`, the console's `↗ open`, a link inside full screen, "open in" another board, the explorer — lands as a loose path at the **left edge** of the board. The explorer's path is a preview: the next explorer click replaces it unless it was kept. **Close all paths** is one act on the board bar. Paths are browser-local, like navigation stacks; a board document never records them. A query column no longer widens when it opens a reader: the reader column has its own width.

**Rider 4 — §11, the column strip.**
> **The column strip.** Above the board, one tab per column, in board order, grouped exactly as the board groups them: a path's tabs sit inside the same band as its columns, labelled with the path's origin. A tab for a column off screen is dimmed. Clicking a tab scrolls the board to that column and makes it the active one; the keyboard's column movement follows the strip. A path tab closes its column and everything after it.

**Rider 5 — §5, `stage` beside `status`.**
> **`stage` is where a document sits in a workflow. `status` is whether work remains. They never substitute for each other.** `stage: <string>` is a core frontmatter field, optional, free-form, filterable (`GET /api/docs?stage=`). Its values are named by the kanban boards that use them (§11); two kanbans over the same documents share one `stage` value, so they should share a vocabulary. A document in any stage is ordinarily `open`. **While a document is in a kanban, its stage decides its status**: a stage the board maps to a status writes that status on entry, and a stage with no mapping writes `open`, in the same commit, named in the response. Writing `status` never moves a stage. Whether a document is "in a kanban" is decided by the board's scope query **with archived documents included**, because a document in a stage mapped to `archived` is still in the kanban.

**Rider 6 — §11, kanban boards.**
> **A kanban is a board over one field.** Its document names the field (`status`, or `stage`), the stages in display order, and optionally the **transitions** — for each stage, the stages a drag may reach — and the **status** map of §5. Its columns are derived, one per stage, from the board's scope query; they are not view documents. A document in scope with no value for the field sits in the first column. **A drag follows a transition and nothing else**: while a document is in flight only the reachable columns accept it, and a drop elsewhere is refused with the reason. Without `transitions` the graph is the linear funnel: each stage leads to its neighbours, both ways. Anything the graph does not allow is done by setting the field in the document, from the reader or the CLI; the server does not enforce transitions, it enforces the status map. Each column shows where it leads; the board document draws the graph. A kanban over `status` has the three statuses of §5 as its only possible stages.

**Rider 7 — §9.2, the API.**
> `GET /api/docs` loses `pinned=` and gains `stage=`. The document row carries `stage`, and for boards `columns`, `kanban` (`{ field, stages, transitions?, status? }`), `default-open` and `order`; `order` is a board's position among boards and nothing else. **Folder acts**: `POST /api/folders/rename`, `/archive`, `/unarchive`, `/delete`, each taking a folder path in the body and each naming every document it changed in its result, under the warning rule above. Archiving a folder flips every document in it; it moves nothing. Deleting a folder is user-only, like deleting a document.

**Rider 8 — §2.4, migrations.**
> An upgrade also reports the **data migrations** the workspace needs — files the installed tool no longer reads as they are written — listed distinctly from updates and conflicts, each as the commands that perform it, so an agent running the upgrade can do the work. The upgrade never performs a migration itself.

**Rider 9 — §7, reflection (added 2026-08-22 after the user asked whether a stage change triggers the agent).**
> **Reflection is an act over the whole corpus, never a side effect of one change.** A stage moved, a status flipped, a tag, a move, an archive: none of these enqueues anything, exactly as before. What reaches the agent is **`workspace.reflect`**, whose payload is one timestamp, `since`: the corpus's last reflection. The agent gathers the window itself (`corpus doc list --since`), reads what it chooses, and pays only for that. The event falls in no scope and takes the orchestrator's lane; the orchestrator may hand a resident the part of the window inside its scope. **Two things produce it.** A person asks — the board bar's Reflect control, or `corpus reflect` — and it is enqueued at once. Or the dust settles: the server enqueues one when something changed after the last reflection, nothing has changed for a **quiet window** (`reflect.quiet`, default 30 minutes, `0` disables the automatic path), and no reflection is pending or running. Ten changes in five minutes are one reflection, half an hour after the last. **The clock** — `reflected`, the `created` time of the last reflection whose job was processed — is server state in `.corpus/`; a failed job leaves it, so a retry sees the same window. **What a reflection produces**: an entry in the changelog of each document the agent has something to say about (§5), and one **standalone thread** per reflection, the digest, whose first turn names the window, so git holds the clock too and a person answers it where Attention shows it. A reflection with nothing to say still posts the thread, in one line. **The board shows what is unreflected**: a document whose `updated` is later than `reflected` is marked on every board, each column counts its own, a board tab carries a dot while it holds any, and the Reflect control carries the corpus count. When the job lands, the marks clear.

### Key Implementation Details
- Read each rider back verbatim, wait for "signed" or a correction, then write it. Do not write rider N+1 before rider N is signed.
- Strike the replaced sentences in the same edit as the rider that replaces them, so §11 never says both.
- The prototype is committed with this issue as `design/navigation.html`; it is not merged into `design/index.html` (the user's call on 2026-08-22 was a separate file while the model settled — revisit at phase end).

### Edge Cases
- If the user rewrites a rider, the dependent issue files cite the signed text, not this draft: re-read them after signing.

## Testing Strategy
None — prose. `npm run lint` covers formatting of the issue and plan files.

## E2E Verification Plan
### Verification Steps
1. `grep -n "No sidebar\|pinned: true\|column widens" SPEC.md` returns nothing in §11.
2. Eight `_(Rider signed 2026-…)_` markers exist for the riders above.

## E2E Verification Log
Orchestrator, 2026-08-22, on fable. Nine riders read back one at a time, each signed by the user ("signed" / "sign it") on the quoted text, each written verbatim into SPEC.md in the same turn:

1. §11 explorer — replaced "No sidebar."; the Shell sentence names the explorer; the Visual reference line names `design/navigation.html`.
2. §11 boards as documents — replaced "Columns are pinned view documents" through "nothing hardwired"; the view's query/stewardship sentence kept and reworded.
3. §11 paths — replaced "Per-column reader"; three phrases amended (creation "in a path off its column", console "loose path at the left edge", keyboard `↵`/`⌥↵`/`esc` order/`⇧esc`).
4. §11 column strip — inserted in "The board."; the ghost column now "creates view documents and adds them to the board".
5. §5 `stage` — frontmatter line added after `evergreen`; coupling paragraph after the 2026-08-12 unarchive rider.
6. §11 kanban — new bullet after "Folder scoping".
7. §9.2 — `pinned=` out, `stage=` in on `/api/docs` and `/api/search`; the 2026-08-08 amendment reworded; folder acts line after `GET /api/tree`; board fields in the `POST /api/docs` line. Consequences applied under it: §9.1 projection columns (`stage`, `board_json`, no `pinned`), §10 plugin column sentence, M4 milestone line.
8. §2.4 migrations — appended.
9. §7 `workspace.reflect` — in the core event types paragraph.

Checks: `grep -c "No sidebar\|column widens\|pinned: true\|create pinned view" SPEC.md` → 0. Remaining `pinned` mentions are the riders saying it left, and "anchor quote pinned at top" (unrelated). Prettier clean. Prototype committed in `a720e6dd`.

## Completion Checklist (domain agent)
- [ ] Riders signed one at a time, each written verbatim
- [ ] `/lint` passes
- [ ] Prototype committed

## Completion Checklist (orchestrator)
- [ ] Committed with `[SHARED-064]` prefix
