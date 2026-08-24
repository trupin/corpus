# Putting an older version back

The comment skill's write loop covers the ordinary edit. This file is the rarer act — a
document, or a passage of one, restored to what it used to say. Read it before you restore
anything.

**Putting an older version back is the same write loop.** There is no revert command and none
is needed: **a revert is a write whose content came from history**, so it reconciles anchors,
validates and commits exactly as every other write does. Read the history:
`corpus doc diff <id>` prints the document's path and its last committed change, and
`git log --oneline -- <path>` then `git show <sha>:<path>` go further back. Work out the
content you want back, which is rarely the whole old file — the version you are going back to
predates everything since, and some of that should stay. Then write it the way the change
fits: a passage you can quote goes back as a patch — `--old` what the document says now,
`--new` what it used to say — and only a document that changed wholesale needs
`corpus doc edit <id> --key <the key that read printed> --from agent`. Either way, say in the
reply what you put back. Three things decide whether this is a repair or a second act of
damage:

- **Read from git, never write to it.** `git log`, `git show` and `git diff` are reads. Never
  `git checkout`, `git restore`, `git revert` or `git commit` — the server is the sole writer
  and every change you make goes through the CLI, this one included.
- **Git hands you the whole file; the write takes the body.** Everything down to and
  including the closing `---` is frontmatter the server owns — id, timestamps, tags,
  `anchors` — so pasting the file in as a body writes that frontmatter into the document
  again, as text. Send only what follows it. A patched revert cannot make this mistake: it
  matches body text and writes body text, so there is no whole file in your hands to paste,
  which is one more reason to undo a passage as a patch rather than as a body.
- **The key is what makes a revert safe.** The content came from history, but the key you
  present names the version you just read, so a revert that would clobber a change made since
  that read is refused with exit `9` rather than landing on top of it. The age of the content
  is never the question; what happened after your read is. A patched revert is guarded by the
  excerpt instead: a passage somebody has since rewritten is not there to match, so it is
  refused with the count rather than landing on top of their words.
