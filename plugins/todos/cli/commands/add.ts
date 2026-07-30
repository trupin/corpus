import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { addItem, fetchLists, resolveList } from "../client.js";

/**
 * `corpus todos add <list> <text>` — append one item to a todo document.
 *
 * A thin client over `POST /api/x/todos/<docId>/items`: the write lands on the
 * core write path server-side (git auto-commit, projection, SSE), attributed to
 * the actor the CLI resolved from `--from` / `CORPUS_FROM`, so an open board
 * updates live and `git log` names who added it.
 *
 * The list is named, not addressed: `corpus todos add "shopping" "milk"`
 * resolves the title before touching the plugin route, which is what lets the
 * agent work from what a thread actually said.
 */
export default {
  name: "add",
  summary: "Add an item to a todo list.",
  description:
    "Appends one open item to a `type: todo` document. The list may be named by id, by its exact " +
    "title, or by an unambiguous fragment of it; an ambiguous name is refused with the candidates " +
    "listed rather than guessed at. The item's `ts` is its creation time, set by the server.",
  args: [
    {
      name: "list",
      required: true,
      description: "Todo document: its id, its title, or an unambiguous fragment of the title.",
    },
    { name: "text", required: true, description: "What the item says." },
  ],
  flags: [
    {
      name: "due",
      type: "string",
      valueName: "date",
      description: "Optional deadline as an ISO calendar date (`2026-08-01`).",
    },
  ],
  examples: [
    {
      command: 'corpus todos add "Week of Jul 20" "Renew passport"',
      description: "Append an item to the list titled “Week of Jul 20”.",
    },
    {
      command:
        'corpus todos add "Week of Jul 20" "Book dentist" --due 2026-08-01 --from agent --json',
      description:
        'One JSON value: `{"docId":"doc_a1b2c3","index":3,"item":{"text":"Book dentist","done":false,"ts":"…","due":"2026-08-01"}}`. `--from agent` makes the commit the agent\'s.',
    },
  ],
  handler: async (context: PluginCommandContext): Promise<void> => {
    const list = resolveList(await fetchLists(context), context.args.get("list"));
    const result = await addItem(
      context,
      list.docId,
      context.args.get("text"),
      context.flags.string("due"),
    );
    context.out.emit({ docId: result.docId, index: result.index, item: result.item });
    context.out.line(
      `added item ${String(result.index + 1)} to ${list.title} [${list.docId}] — ${
        result.item?.text ?? context.args.get("text")
      }`,
    );
  },
} satisfies PluginCommandSpec;
