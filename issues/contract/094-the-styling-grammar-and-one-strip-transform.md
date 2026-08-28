# [CONTRACT-094] The styling grammar, and the one strip transform

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: UI-182, UI-183, UI-184, SERVER-162

## Spec References

- SPEC.md §5 — "**Styled text lives in the body, as text.** Corpus markdown
  admits three styling forms beyond CommonMark/GFM … The attribute vocabulary is
  **closed** and named by this spec: `color`, `highlight`, `align`, `indent`."
- SPEC.md §5 — "**Clean markdown is always extractable.** Stripping is one
  defined transform — drop the wrapper, keep the inner text; `<u>` and `==`
  marks likewise."
- SPEC.md §5 — "**Every passage-shaped answer serves the stripped form** …
  The index never embeds a marker."
- `packages/contract/src/headings.ts` — why the contract owns a format rule
  (CONTRACT-070)
- `packages/contract/src/code.ts` — `fencedCodeRanges`, the existing fence scan

## Summary

SPEC §5's styled-text rider was signed on 2026-08-12 and no code implements it.
Three consumers need the same answer about what a styling marker is: the editor
parses and serializes them (`apps/ui`), the reader renders them
(`packages/kit`), and the server strips them out of everything passage-shaped
(`apps/server`). This issue puts the grammar and the strip in the one package
all three already depend on, so none of them can disagree about what a marker
is.

**Why the contract owns it** is `headings.ts`'s reasoning verbatim: a styling
marker is a *format* rule, and the format has readers outside any one
application. `apps/server` may not import `packages/kit`, so with the grammar in
the kit the only way for the server to strip would be a second copy of it.

## Acceptance Criteria

- [ ] The four forms §5 names are recognised, and nothing else is
- [ ] The attribute vocabulary is closed at `color`, `highlight`, `align`,
      `indent`; a marker carrying any other attribute **is ordinary text**, not
      an error and not a marker with an ignored attribute
- [ ] No marker is recognised inside a fenced code block or an inline code span
- [ ] `stripStyling` removes exactly the markers and keeps every inner
      character, and returns its input unchanged when the input carries none
- [ ] `stripStyling` is idempotent: stripping stripped text changes nothing
- [ ] The module parses no markdown beyond these four forms — emphasis,
      headings, links and lists are invisible to it (sprint-019 Adjudication 5
      stands: `apps/server` gains no markdown parser)
- [ ] Exported from `@corpus/contract`'s index

## Technical Design

### Files to Create/Modify

- `packages/contract/src/styled.ts` — new; the grammar, the vocabulary and
  `stripStyling`
- `packages/contract/src/styled.test.ts` — new
- `packages/contract/src/index.ts` — export it

### The grammar

**Inline, three forms.**

1. **Underline** — `<u>` … `</u>`, exactly those two tokens, lowercase, no
   attributes and no whitespace inside the brackets. `<U>`, `<u >` and
   `<u class="x">` are ordinary raw HTML and stay inert.
2. **Highlight** — `==` … `==`, with emphasis's flanking rule: the opening `==`
   is followed by a non-whitespace character and the closing `==` is preceded by
   one. `a == b` is arithmetic, not a highlight.
3. **Attribute span** — `[` text `]{` attributes `}`. The text may not contain
   `]`; the attribute list is `name="value"` pairs separated by blanks.

**Block, one form.**

4. **Attribute div** — a line that is exactly `::: {` attributes `}` opens one,
   and a later line that is exactly `:::` closes it. Both fence lines stand
   alone on their own lines. A `:::` glued to prose is prose.

### The vocabulary, and where each attribute is admissible

`color` and `highlight` are **inline** attributes. `align` and `indent` are
**block** attributes. This partition is a call this issue makes, and the reason
is §5's own: a control that "did nothing at all while appearing to work" is the
failure the rider forbids, and aligning a phrase inside a paragraph has no
rendering in any target. An attribute used in the wrong position makes its
marker ordinary text, exactly as an unknown name does.

| Attribute | Position | Values |
| --- | --- | --- |
| `color` | inline | `accent`, `warning`, `positive`, `muted` |
| `highlight` | inline | `accent`, `warning`, `positive`, `muted` |
| `align` | block | `left`, `center`, `right`, `justify` |
| `indent` | block | `1`, `2`, `3` |

§5 leaves the `align` and `indent` **value sets** to the implementation
(SHARED-035's sign-off says so). The four colour roles are the spec's own.

### Exports

```ts
export const STYLE_ROLES = ["accent", "warning", "positive", "muted"] as const;
export const ALIGN_VALUES = ["left", "center", "right", "justify"] as const;
export const INDENT_LEVELS = [1, 2, 3] as const;

export type StyleRole = (typeof STYLE_ROLES)[number];
export type StyleAlign = (typeof ALIGN_VALUES)[number];

/** One recognised inline marker found in a line of text. */
export interface InlineStyleMatch {
  readonly kind: "underline" | "highlight" | "span";
  /** Offsets into the scanned string: the whole marker, and its inner text. */
  readonly start: number;
  readonly end: number;
  readonly innerStart: number;
  readonly innerEnd: number;
  /** Attributes, for `span`; empty for the other two. */
  readonly attrs: StyleAttributes;
}

export interface StyleAttributes {
  readonly color?: StyleRole;
  readonly highlight?: StyleRole;
  readonly align?: StyleAlign;
  readonly indent?: number;
}

/** Every recognised inline marker in `text`, outermost-first, non-overlapping. */
export function scanInlineStyles(text: string): readonly InlineStyleMatch[];

/** The attributes a `{...}` list holds, or `null` when it is not admissible. */
export function parseStyleAttributes(source: string, position: "inline" | "block"): StyleAttributes | null;

/** The canonical spelling of an attribute list, for the serializer. */
export function formatStyleAttributes(attrs: StyleAttributes): string;

/** `::: {…}` — the attributes it opens with, or `null` when the line is prose. */
export function blockFenceAttributes(line: string): StyleAttributes | null;

/** Whether a line closes a styled block. */
export function isBlockFenceClose(line: string): boolean;

/** §5's one defined transform: drop the wrapper, keep the inner text. */
export function stripStyling(markdown: string): string;
```

`formatStyleAttributes` fixes the order — `color`, `highlight`, `align`,
`indent` — and always double-quotes, so the serializer's output is canonical and
a round trip is byte-stable.

### `stripStyling`

Fence-aware through `fencedCodeRanges` from `./code.js`, which the server
already trusts for headings. Inline code spans are found with the same scan
`code.ts` uses. Inside either, nothing is a marker.

The transform:

- `<u>x</u>` → `x`
- `==x==` → `x`
- `[x]{color="accent"}` → `x`
- an opening `::: {…}` line and its closing `:::` line are **removed entirely**,
  along with the newline each occupies; the blocks between them stay

Everything else is returned byte for byte. A body with no marker is returned as
the same string (identity, checked by test).

### Edge Cases

- **Nested markers.** `==a <u>b</u> c==` — the outer highlight is one match and
  the inner underline is found when the inner text is scanned. `scanInlineStyles`
  returns outermost, non-overlapping matches, and the caller recurses.
- **An unterminated marker** is ordinary text: `==a` is `==a`.
- **An empty marker** — `====`, `<u></u>`, `[]{color="accent"}` — is ordinary
  text. A mark over nothing is not something the file can say.
- **`==` inside a word** — `a==b` — has no flanking whitespace either side and
  is a highlight by the same rule `**` follows. Documented rather than special
  cased.
- **An attribute value with a `}`** cannot occur: values are drawn from closed
  sets, so a value containing `}` is not admissible and the marker is text.
- **A `:::` fence with no close** leaves every line as prose.
- **A styled block inside a list item or a blockquote** is out of scope for the
  strip's line scan, which removes any line that *is* a fence line at any
  indentation up to three spaces. The prose inside is untouched either way.

## Testing Strategy

`packages/contract/src/styled.test.ts`:

- each form, recognised, with its offsets
- each near-miss — `<U>`, `<u >`, `a == b`, `[x]{colour="accent"}`,
  `[x]{color="chartreuse"}`, `[x]{align="center"}`, `::: {color="accent"}` —
  producing **no** match
- fence-awareness: every form inside ``` and inside a code span, unrecognised
- `stripStyling` on a corpus-shaped body: markers gone, every other byte equal
- `stripStyling` identity on marker-free text, asserted with `toBe`
- `stripStyling` idempotence
- `formatStyleAttributes` round-trips through `parseStyleAttributes`

## E2E Verification Plan

A contract module has no interface of its own. It is verified through its three
consumers (UI-182, UI-183, UI-184, SERVER-162) and by its unit tests. The E2E
log here records the falsification: break each recogniser in turn and name the
tests that go red.

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

`packages/contract/src/styled.test.ts` — **55 tests, all passing**:

```
Test Files  1 passed (1)
     Tests  55 passed (55)
```

**Falsification, three ways.** Each break was made in the module and the suite
re-run, so no assertion below is one that passes whether or not the code is
there.

| Break | Result |
| --- | --- |
| Drop the inline/block position partition in `parseStyleAttributes` | 4 failed |
| `stripStyling` passes no code ranges to the inline pass | 1 failed |
| Remove the highlight's opening flanking rule | 1 failed |

Restored, 55 passed. The four the position partition catches are the ones that
matter most: `[a]{align="center"}` and `::: {color="accent"}` both become
ordinary text, which is what stops a marker rendering as nothing while looking
like it worked.

**Identity is asserted, not assumed.** `stripStyling` over a CRLF body with no
marker returns the same string by `toBe`, so the transform that runs over every
body at projection time cannot normalise a line ending.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
