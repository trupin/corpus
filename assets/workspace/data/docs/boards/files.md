---
id: doc_seedboardfiles
type: board
title: Files
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: []
status: open
anchors: {}
evergreen: true
order: 3
columns: []
default-open: true
---

A board with no query columns, for reading the corpus through the explorer. Open the explorer
at the left edge, click a document, and it opens here as a column of its own; follow a link
inside it and the reading continues to the right. Nothing is listed until you ask for
something, which is the point of this one.

`default-open: true` makes this the board a browser opens onto, and the board that receives
every open that names no board — the explorer's clicks among them. At most one board carries
the flag: setting it on another board clears it here, and the write says so. With none set,
the first board in `order` receives those opens.

Add columns to it and it becomes an ordinary board — put a view's id in `columns` and it
appears. Nothing here is hardwired: rename this board, reorder it, archive it. One board is
always showing, so the board bar refuses to archive the last one there is.
