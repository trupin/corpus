import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { fetchLists, resolveList, type TodoList } from "../client.js";

/**
 * `corpus todos list [<list>]` — every todo list, or one of them in full.
 *
 * The JSON shape is the **same either way** — `{"lists":[…]}`, with one entry
 * when a list is named. A verb whose machine-readable output changes shape
 * with its arguments is a verb every caller has to branch on, and the agent is
 * the caller that pays for that.
 */

/** `2 open · 1 done` — the summary a human reads first. */
function counts(list: TodoList): string {
  return `${String(list.open)} open · ${String(list.done)} done`;
}

function renderItems(context: PluginCommandContext, list: TodoList): void {
  for (const [index, item] of list.items.entries()) {
    const due = item.due === undefined ? "" : `  (due ${item.due})`;
    context.out.line(
      `  ${String(index + 1).padStart(2, " ")} ${item.done ? "☑" : "☐"} ${item.text}${due}`,
    );
  }
}

export default {
  name: "list",
  summary: "Show todo lists and their items.",
  description:
    "With no argument, one line per `type: todo` document with its open and done counts. With a " +
    "list named — by id, exact title, or an unambiguous fragment — that list's items, numbered as " +
    "`corpus todos check` accepts them and in the order they appear in the document body. " +
    "Archived todo documents are excluded, exactly as every other default list excludes them.",
  args: [
    {
      name: "list",
      required: false,
      description: "Todo document to show in full: its id, its title, or a fragment of the title.",
    },
  ],
  flags: [
    {
      name: "open",
      type: "boolean",
      description: "Show only items that are still open.",
    },
  ],
  examples: [
    {
      command: "corpus todos list",
      description: "Every todo list with its open and done counts.",
    },
    {
      command: 'corpus todos list "Week of Jul 20" --json',
      description:
        'One JSON value: `{"lists":[{"docId":"doc_a1b2c3","title":"Week of Jul 20","path":"data/docs/todos/week.md","status":"open","open":2,"done":1,"items":[{"text":"Renew passport","done":false}]}]}`.',
    },
  ],
  handler: async (context: PluginCommandContext): Promise<void> => {
    const all = await fetchLists(context);
    const named = context.args.optional("list");
    const selected = named === undefined ? all : [resolveList(all, named)];

    const lists = context.flags.boolean("open")
      ? selected.map((list) => ({ ...list, items: list.items.filter((item) => !item.done) }))
      : selected;

    context.out.emit({ lists });

    if (lists.length === 0) {
      context.out.line("no todo lists.");
      return;
    }
    for (const list of lists) {
      context.out.line(`${list.title} [${list.docId}] — ${counts(list)}`);
      // The whole-workspace listing stays a table: expanding every item of
      // every list is what `corpus todos list <name>` is for.
      if (named !== undefined) renderItems(context, list);
    }
  },
} satisfies PluginCommandSpec;
