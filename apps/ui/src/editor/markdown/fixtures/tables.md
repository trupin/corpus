| Option | Rate  | Notes            |
| ------ | ----- | ---------------- |
| 30-yr  | 6.4%  | quoted this week |
| 15-yr  | 5.85% | needs a check    |

Aligned columns survive:

| Left | Center | Right |
| :--- | :----: | ----: |
| a    |    b   |     c |

A break inside a cell is `<br>`, because every markdown spelling of one is a
newline and a newline ends the row:

| Term    | Meaning                                           |
| ------- | ------------------------------------------------- |
| escrow  | held by a third party<br>until both sides perform |
| **PMI** | private<br>mortgage<br>insurance                  |

A pipe is content only where it is escaped, and the constructs that carry one
are not only text — a reference's alias is spelled with a pipe:

| Construct  | Cell                              |
| ---------- | --------------------------------- |
| text       | 2 failed \| 8 passed              |
| code span  | `commit: string \| null`          |
| raw inline | <kbd>\|</kbd>                     |
| reference  | [[doc_z9y8x7\|the earlier draft]] |
