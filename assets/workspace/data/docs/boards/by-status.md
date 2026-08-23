---
id: doc_seedboardbystatus
type: board
title: By status
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: []
status: open
anchors: {}
evergreen: true
order: 2
query:
  type: note
kanban:
  field: status
  stages: [open, resolved, archived]
---

Every note, in one column per status. This is a **kanban**: a board over one field. It carries
no `columns`, because a kanban's columns are derived — one per stage, drawn from the `query`
scope above and narrowed to that stage — and they are not view documents. Dragging a note
between columns writes the field.

`transitions` is deliberately absent, which means the linear funnel: each stage leads to its
neighbours, both ways, so a note moves open → resolved → archived and back. Writing the graph
out as `transitions: {}` would mean the opposite — a graph nothing may be dragged along — so
leave the key off unless you mean to name a route. Anything the graph does not allow is still
done by setting the field itself, from the reader or with `corpus doc edit`.

A kanban over `status` has the three statuses as its only possible stages, and it needs no
`status` map: the field it draws already is the status. A kanban over `stage` — the free-form
workflow position — is the other shape, and there the `kanban.status` map is what says which
stage settles a document.
