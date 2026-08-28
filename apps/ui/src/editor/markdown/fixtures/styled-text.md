# Styled text

A phrase can be <u>underlined</u>, a phrase can be ==highlighted==, and a phrase can be [given a role]{color="accent"}.

Roles compose: [both at once]{color="warning" highlight="muted"} is one span.

Styling wraps other marks: ==a **bold** run==, ==a `code` run==, and ==a [link](https://example.com) run==.

It nests: ==a <u>doubly marked</u> phrase==, and [==a highlighted span==]{color="positive"}.

A styled reference reads as one: [[[doc_a1b2c3]]]{color="accent"}.

- A ==bright== list item
- An item with [a muted aside]{color="muted"}

| Heading  | Note             |
| -------- | ---------------- |
| ==Cell== | <u>Also here</u> |

> A ==quoted== highlight.

Prose that only looks like styling stays prose: \==not a highlight\==, and \[not a span]{color="accent"}.

A marker inside code is a sample: `==this==` and `[that]{color="accent"}`.

```
==not a marker==
<u>nor this</u>
```
