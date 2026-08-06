A fence must open wider than the longest backtick run inside it, or it closes
early and one block becomes several (AGENT-012). Three inside, so four outside:

````prompt
## Output format

```
owner | action | topic
```

**Critical instruction:** answer only in that table.
````

The rule is the count, not the number four — four inside, so five outside:

`````markdown
````prompt
a payload that itself hands over a fenced payload
````
`````

A run in the middle of a line closes nothing — only a line that is nothing but
the run does. The printer still widens for it, being conservative rather than
minimal, and that is what this pins:

````
a ``` inside a line of text
````
