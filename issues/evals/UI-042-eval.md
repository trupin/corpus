# Evaluation: UI-042

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/`, workspace
`/tmp/eval-dogfood-ws`, **no transport stub**. Chromium context granted
`clipboard-read` + `clipboard-write` for the origin; every flavor below was read
back with a real `navigator.clipboard.read()`, and every paste was a real `⌘V`
after a real `navigator.clipboard.write()`. Saved bodies read off the wire
(`PUT /api/docs/…`) **and** off disk.

Fixture: `doc_p2l2favt` "Quarterly memo" — h1-less body with paragraph +
`**bold**`/`*italic*`/`` `code` ``, an `## Findings` heading, a bullet list, an
ordered list, a task list with both states, an external link, a
`[[doc_wqmewqgt]]` ref to "Lender spreads", and a `ts` code fence.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Verification log present                | PASS   | Five sections plus a follow-up for the menu path                            |
| Commands are specific and concrete      | PASS   | Verbatim clipboard dumps in both directions, both pre- and post-fix         |
| Real E2E (not mocked)                   | PASS   | Real OS clipboard through a real browser                                    |
| Scenarios cover acceptance criteria     | PASS   | All five                                                                    |
| Application restarted after changes     | PASS   | Named ports per run                                                         |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (`claude-opus-5[1m]`)"                                       |
| Reproduction logged before fix (bugs)   | PASS   | **Two** reproductions: ⌘C flavors, and the menu path's `TYPES: ["text/plain"]` |

The menu-path reproduction (§2 of the log) is the one that matters — it is the
path the user actually reported, and it was captured before any fix.

## Criteria Results

| #   | Criterion                                                 | Result | Notes                                                            |
| --- | --------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| 1   | Pre-fix reproduction logged                               | PASS   | Both paths, verbatim, dated before the fix                       |
| 2   | Copy: text/html structural, text/plain markdown           | PASS   | Both flavors on **both** paths; bytes identical between them     |
| 3   | Google-Docs paste → clean markdown, no HTML leak          | PASS   | Verified with my own independently-authored Docs-shaped fixture  |
| 4   | `[[refs]]` copy per the rider                             | PASS   | HTML flavor is a `<span>` with the **title**; no `<a>`, no id    |
| 5   | Anchors/threads unaffected                                | PASS   | Anchors on the pasted-into doc reconcile normally; none orphaned |

### Both copy paths, real clipboard

**⌘C** over `⌘A` in the body:

```
types: ["text/plain","text/html"]
```

`text/html` (verbatim):

```html
<p data-pm-slice="0 0 []">Lead paragraph with <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p><h2>Findings</h2><ul><li><p>first bullet</p></li><li><p>second <strong>bold</strong> bullet</p></li></ul><ol><li><p>one</p></li><li><p>two</p></li></ol><ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>open task</p></div></li><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done task</p></div></li></ul><p>See <a target="_blank" rel="noreferrer noopener" href="https://example.com/">the site</a> and <span data-corpus-ref="doc_wqmewqgt" class="ref">Lender spreads</span>. The rate moved to 6.4% this week.</p><pre><code class="language-ts">const x = 1;</code></pre>
```

`text/plain` (verbatim):

```
Lead paragraph with **bold** and *italic* and `code`.

## Findings

- first bullet
- second **bold** bullet

1. one
2. two

- [ ] open task
- [x] done task

See [the site](https://example.com) and [[doc_wqmewqgt|Lender spreads]]. The rate moved to 6.4% this week.

```ts
const x = 1;
```
```

**Right-click → Copy** (the reported path), same selection, clipboard first
poisoned with a `SENTINEL` so a no-op would be visible:

```
menu: {"label":"Actions for the selection",
       "items":["💬 Comment on selection","Copy","Cut","Paste"]}
menu types: ["text/plain","text/html"]
menu.html === keyboard.html : true
menu.text === keyboard.text : true
```

The two paths are byte-identical. The pre-fix `TYPES: ["text/plain"]` defect is
gone.

### `[[ref]]` fidelity

HTML flavor: `<span data-corpus-ref="doc_wqmewqgt" class="ref">Lender spreads</span>`
— the **title** as visible text, a `<span>` rather than an `<a>` (the target has
no external address), no `about:blank#…`, no `doc_` id in anything an external
editor renders. This is what the rider governs and it is correct.

### Phrase copies — no trailing newline

Mid-sentence selection `"The rate moved to"`, both paths:

```
keyboard: text="The rate moved to"  trailingNewline=false  types=["text/plain","text/html"]
          html="<p data-pm-slice=\"1 1 []\">The rate moved to</p>"
menu    : text="The rate moved to"  trailingNewline=false  types=["text/plain","text/html"]
          html="<p data-pm-slice=\"1 1 []\">The rate moved to</p>"
```

Cross-mark phrase (starts in plain text, ends past a `<strong>`):

```
selected: "paragraph with bold and "
text    : "paragraph with **bold** and"   trailingNewline=false
html    : "<p data-pm-slice=\"1 1 []\">paragraph with <strong>bold</strong> and </p>"
```

Whole-document copies **do** keep the closing newline (see the ⌘C dump above) —
the file/phrase distinction the follow-up describes is real and correct.

### Paste in — my own Google-Docs fixture

I did not reuse the repo's captured fixture; I authored a 6412-byte Docs-shaped
HTML with the full set of Docs tells: the
`<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper,
`<span style="font-weight:700">` bold, `font-style:italic`,
`text-decoration:underline`, `<p dir="ltr" role="presentation">` inside `<li>`,
`google.com/url?q=…&sa=D&…&usg=…` redirect links, block-level `<br />`s, a
`<colgroup>`-bearing bordered table, and per-span `font-size`/`font-family`/
`color` on every run. Written to the clipboard as a two-flavor `ClipboardItem`,
then `⌘A` `⌘V` in the body of a scratch document.

Saved body (read off the `PUT` and confirmed byte-for-byte on disk at
`data/docs/inbox/paste-target.md`):

```
# Quarterly memo

Lead paragraph with **bold**, *italic* and underlined copy.

## Findings

- first bullet
- **second** bullet

1. step one
2. step two

See [the rates page](https://example.com/rates) for the numbers.

| **Lender** | **Spread** |
| ---------- | ---------- |
| Acme       | 6.1%       |
```

`grep -c -E '<span|style=|docs-internal-guid|google\.com/url|^\\$'` over the
saved file → **0**. The redirect wrapper resolved to the real target
(`https://example.com/rates`), the block-level `<br />`s produced no stray `\`
hard-break lines, underline (no schema node) degraded to its text, the table
survived.

Plain-markdown paste unchanged:
`writeText("## Pasted heading\n\n- pasted bullet\n")` → ⌘V → saved body is
exactly `"## Pasted heading\n\n- pasted bullet\n"`.

Corpus round trip (copy the whole memo, paste it into another document) comes
back byte-clean, ref intact:

```
… See [the site](https://example.com) and [[doc_wqmewqgt]]. The rate moved to 6.4% this week.

```ts
const x = 1;
```
```

## Failures

None.

## Notes (not failures)

- **The markdown flavor emits `[[id|Title]]`, not bare title text.** A person
  pasting into a plain-text target does see `doc_wqmewqgt`. I probed whether
  this is a rider violation and concluded it is not: SPEC §11's rider governs
  what "external rich-text editors receive", and the `text/html` flavor — the
  one those editors read — carries title-only. The id in the markdown flavor is
  the round-trip carrier (the round trip above normalises `[[id|Title]]` back to
  `[[id]]`, proving the pipe form is a recognised label, not corruption), exactly
  as `data-corpus-ref` is in the HTML. Worth noting because the issue's own log
  calls the plain flavor "the document's markdown, byte for byte", which it is
  not — the stored file says `[[doc_wqmewqgt]]`. Cosmetic inaccuracy in the log,
  correct behaviour in the product.

## Summary

5 of 5 criteria passed. Both copy paths now put identical two-flavor content on
the real OS clipboard; refs render as titles in the flavor that matters; a
Google-Docs paste I built myself (not the repo's fixture) converts to clean
markdown with zero HTML residue on disk; and phrase copies carry no trailing
newline on either path while whole-document copies still do.
