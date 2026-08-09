A list item may hold blocks of its own, and each one has to stay the item's:

- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.

  A trailing paragraph of the outer item, which belongs to it and not to the
  sublist above.
- Second outer bullet.

  ```sh
  npm run build
  ```

  Prose after the fence, still the second item's.
- Third outer bullet.

  > A quotation inside a list item.

  Prose after the quotation, which is not part of it.
- Fourth outer bullet.

  | Column | Meaning |
  | ------ | ------- |
  | a      | first   |

  Prose after the table, which is not another row of it.

Ordered items indent by their marker width, and the rule is the same:

1. Outer item leads in.
   1. Nested step one.
   2. Nested step two.

   A trailing paragraph of the outer item.
2. Second outer item.

Three levels, with a trailing paragraph on the middle item:

- Outer.
  - Middle.
    - Inner.

    A trailing paragraph of the middle item.

  A trailing paragraph of the outer item.

Task items are lists too:

- [ ] Task leads in.
  - [x] A nested task.

  A trailing paragraph of the outer task.
