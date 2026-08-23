---
id: doc_seedboardattention
type: board
title: Attention
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: []
status: open
anchors: {}
evergreen: true
order: 1
columns: [doc_seedattention, doc_seedinbox, doc_seedopenthreads]
---

The working board: what is waiting on you, what you captured but have not filed, and what is
still being discussed. A board is a document, and this frontmatter is the whole of it — the
`columns` list names three view documents under `data/docs/views/`, in the order they appear,
and that list is the only thing that puts a view on a board. A view is a saved query and
nothing more, so the same view may sit on this board and on another.

Change the board by editing this document. Add a column by adding a view's id to `columns`,
remove one by taking its id out, reorder them by moving the ids. The `order` above is this
board's own place in the bar, and the bar is reordered as a whole rather than a board at a
time: `corpus board order` takes every board, first tab first, and renumbers them in one
commit. Ask the agent for any of it: "pin me a view of unresolved finance threads" creates
the view and adds its id here.
