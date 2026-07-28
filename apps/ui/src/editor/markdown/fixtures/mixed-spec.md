## Editing surface

The body is **always editable**: there is no mode, no button, and no ceremony.
Typing `## ` at the start of a line makes a heading; typing `- ` makes a list.

### Rules

1. Headings emit ATX, never setext.
2. Bullets emit `- `.
   1. Ordered markers keep the source's first number.
   2. Nesting indents by the marker width.
3. The file ends with exactly one newline.

- [ ] verify the round trip
- [x] write the fixtures

> The serializer is the contract — see [[doc_a1b2c3]].
>
> - it is deterministic
> - it is idempotent

| Construct | Emitted as |
| --------- | ---------- |
| bold      | `**`       |
| italic    | `*`        |

A hard break here\
and prose after it, ending with a bare link: https://example.com
