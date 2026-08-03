# Evaluation: UI-041

**Date**: 2026-08-02
**Sprint**: sprint-023
**Verdict**: PASS

## Test environment

Real `corpus init` workspace at `/tmp/eval-dogfood`, real server on **:8791**,
**real built UI served by the server** at `http://127.0.0.1:8791/` — no Vite dev
server, no `stubCorpus`, no `**/api/threads/**` interception. The thread and its
turns are real documents on disk, written through `corpus thread create`. Real
headless Chromium with `clipboard-read` + `clipboard-write` granted; every
clipboard assertion is `navigator.clipboard.readText()` read back from the real
system clipboard after the click.

Fixtures: `th_e2qkadj7` "Fence copy probe" — an agent turn with three fences
(a ```` ```prompt ```` block containing a blank line, two-space and four-space
indentation, double quotes and a literal `[[doc_x]]`; a bare fence; a ```` ```bash ````
block whose author left a deliberate blank final line) plus one inline `code`
span. And `doc_5oa2xg76` "Doc body fence probe", a **document body** carrying a
fence, for the editable-surface negative.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                                        |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, four numbered specs plus a component-test inventory.                                                                                                                                                 |
| Commands are specific and concrete      | PASS   | Quotes the exact copied bytes, the exact `aria-label`/`title` strings, and the assertions (`.endsWith("\n") === false`, `not.toContain("\`\`\`")`).                                                            |
| Real E2E (not mocked)                   | **PASS, with a caveat** | Real Chromium, real `MarkdownView`, **real `navigator.clipboard`** — but the corpus and turns come from `stubCorpus` + an intercepted `**/api/threads/**` route. Declared honestly. I re-ran everything against a real server with real thread files and reproduced it, which closes the gap. |
| Scenarios cover acceptance criteria     | PASS   | All five criteria have matching evidence, including the refusal path and the editable-body negative.                                                                                                          |
| Application restarted after changes     | PASS   | §2 records a live reproduction of the Enter-key defect and a green re-run after the fix.                                                                                                                      |
| Actual model recorded (implemented on:) | PASS   | "**Model: Opus 5 (claude-opus-5[1m]), ui-dev, 2026-08-02.**"                                                                                                                                                  |
| Reproduction logged before fix (bugs)   | N/A / PASS | Not a bug issue, but §2 contains a genuine mid-implementation reproduction: the board's global `↵` handler calls `preventDefault()` and cancelled the button's native activation — reproduced live (`:focus-visible true`, clipboard unchanged), then fixed. I re-verified the fix independently. |

The log's most checkable claim is the exact copied string. It reproduces
byte-for-byte against the real server, including the blank line and both
indentation levels — not something that survives being written from memory.

## Criteria Results

| #   | Criterion                                                                              | Result | Notes                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 1   | Every fenced block in a rendered turn shows a copy affordance; click copies raw text exactly | PASS   | 3 fences, 3 buttons; all three clipboard reads byte-exact, no fence markers.                       |
| 2   | Brief copied-confirmation, then the button restores; keyboard reachable                | PASS   | `Copy` → `Copied` → `Copy`; `Tab` reaches the next button, `Enter` and `Space` both activate.       |
| 3   | Info string renders as the block label when present; absent → no label                 | PASS   | `prompt` / none / `bash`, matching the three fences.                                               |
| 4   | Clipboard failure degrades to an honest error state, not a silent no-op                | PASS   | Three different failure modes, including a **real** browser permission refusal.                    |
| 5   | Editable document bodies unchanged                                                     | PASS   | Document-body fence has no `.fence`, no copy button, and is still typeable.                        |

## Evidence

### AC 1 + AC 3 — the survey

```
fence 0  .fence  label="prompt"  [data-fence-copy] aria="Copy the prompt block"  opacity@rest 0
fence 1  .fence  label=null      [data-fence-copy] aria="Copy the code block"    opacity@rest 0
fence 2  .fence  label="bash"    [data-fence-copy] aria="Copy the bash block"    opacity@rest 0
inline <code> spans: 1, with a copy button: 0
```

The bare fence has **no** `.fence-label` element at all (not an empty one), and
the aria-label degrades to "the code block". Inline code is untouched.

### AC 1 — the copied bytes, read back from the real clipboard

The clipboard was seeded with `SENTINEL-NOT-COPIED` before each click, so an
unchanged clipboard would fail rather than silently match.

| Fence | clipboard read back                                                              | ends with `\n` | contains ` ``` ` |
| ----- | -------------------------------------------------------------------------------- | -------------- | ---------------- |
| 0     | `You are a drafting agent.\n\n  Rewrite [[doc_x]] as:\n    - one "line"\n    - two` | **false**      | false            |
| 1     | `corpus doc list --type note`                                                     | **false**      | false            |
| 2     | `echo one\n`                                                                      | **true**       | false            |

Byte-exact against the source markdown: the blank line, the two-space and
four-space indentation, the double quotes and the literal `[[doc_x]]` all survive.
Fence 2 is the trailing-newline decision working as designed — its author left a
deliberate blank final line, and exactly one newline (the `<pre>` serialisation
artifact) came off, leaving the blank line intact. Fences 0 and 1 have no
trailing newline surprise.

Note the rendered `<code>` text for fence 0 is
`"You are a drafting agent.\n\n  Rewrite [[doc_x]] as:\n    - one \"line\"\n    - two\n"` —
one character longer than what was copied. The copy is not scraping the DOM.

### AC 2 — confirmation, restore, keyboard

```
click  → textContent "Copied", aria "Copied the prompt block to the clipboard"
+2.6 s → textContent "Copy"                      (restores on its own)
```

Confirmed independently for all three buttons; state is per-fence, not shared.

Keyboard: focus button 0, press `Tab` → `document.activeElement` is button **1**
(`BUTTON`), computed `opacity` **1** (revealed by focus, so a keyboard user can
see what they are on). `Enter` → clipboard holds `corpus doc list --type note`,
button reads `Copied`. `Space` on button 2 → clipboard holds `echo one\n`. Neither
key scrolled the page (`window.scrollY === 0`) nor closed the reader — the board's
global `↵` shortcut and the button's activation coexist.

Rapid double-click: state stays `fence-copy copied`, the clipboard holds the
correct text, and the button still restores to `Copy` — the restore timer is not
left dangling.

### AC 4 — failure paths, including a real refusal

| Mode                                                    | button text   | aria-label                                                                                                  |
| ------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Real** browser refusal (fresh context, no clipboard permission granted) | `Copy failed` | `Could not copy the prompt block — Failed to execute 'writeText' on 'Clipboard': Write permission denied`     |
| `writeText` rejects `NotAllowedError`                   | `Copy failed` | `Could not copy the prompt block — Write permission denied`                                                  |
| `navigator.clipboard` absent (insecure-context shape)   | `Copy failed` | `Could not copy the prompt block — this browser gives the page no clipboard access`                          |

All three set `class="fence-copy failed"`, put the reason in `title` as well, and
throw no uncaught page error. The first row is the important one: Chromium itself
refused, with no stubbing — the honest error state is what a real user with
clipboard permissions denied would actually see.

### AC 5 — editable document bodies unchanged

`doc_5oa2xg76` opened in the reader (which **is** the contenteditable):

```
contentEditable present : true
<pre> elements          : 1
[data-fence-copy]       : 0
.fence wrappers         : 0
markup                  : <pre><code class="language-prompt">This fence lives in a document body and must stay editable.</code></pre>
```

And it is still an editable body, not merely un-decorated: placing a caret at the
end of the code block and typing produced
`"This fence lives in a document body and must stay editable. EDITED"`. The copy
affordance is confined to the rendered-markdown surface, exactly as the criterion
requires.

Screenshots: `/tmp/eval-dogfood/shots/40-thread-fences.png`,
`41-doc-body-fence.png`, `50-no-permission.png`, `50-denied.png`,
`50-no-clipboard-api.png`.

## Failures

None.

## Subjective quality (the fence canvas)

- Design quality **4** — the fence reads as a distinct canvas: a small lowercase
  monospace label sitting above a bordered, tinted block, with the copy control
  out of the way until wanted. It belongs to the same visual family as the
  surrounding turn without competing with it.
- Originality **3** — hover-revealed copy on a code block is a well-worn pattern;
  the deliberate choices here are the info-string-as-label treatment and the
  three-state button with a spoken reason on failure.
- Craft **5** — opacity 0 → 1 on hover *and* on `:focus-visible`; per-fence state;
  correct `aria-label` in all three states; no trailing-newline artifact; the
  global `↵` shortcut conflict found and resolved rather than papered over.
- Functionality **5** — the affordance is discoverable on hover, reachable by
  `Tab`, activatable by `Enter` or `Space`, and never fails silently.

Average 4.25, no score of 1.

## Summary

**5 of 5 criteria passed.** Every fenced block in a rendered turn carries a copy
button; the copied bytes are exactly the content between the fence markers,
including blank lines, indentation and quotes, with no ` ``` ` and no trailing
newline surprise; the info string becomes the label and its absence leaves none;
the button confirms and restores and is fully keyboard-operable; every clipboard
failure — including a genuine browser permission refusal — produces a visible,
specific error rather than a no-op; and the editable document body is untouched
and still typeable. Verified against the real server with real thread files, not
the implementation's stubbed transport.
