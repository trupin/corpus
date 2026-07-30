import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { resolveSelector } from "../../items.js";
import { fetchLists, resolveList, setDone } from "../client.js";

/**
 * `corpus todos check <list> <item>` — check an item off (or, with
 * `--uncheck`, put it back).
 *
 * The item is addressed the way a person would: by its number as
 * `corpus todos list` prints it, or by its text, matched case-insensitively.
 * Duplicate text is refused with the candidate numbers named — checking off
 * the wrong one of two identically-worded items is a mistake nobody notices
 * until the wrong thing is missing.
 *
 * The request carries the text the CLI just read at that index, so a
 * concurrent edit answers `409` and writes nothing rather than toggling
 * whatever moved into place.
 */
export default {
  name: "check",
  summary: "Check an item off a todo list.",
  description:
    "Sets `done: true` on one item of a `type: todo` document — or `false` with `--uncheck`. The " +
    "item is named by its 1-based number (as `corpus todos list` prints it) or by its text, " +
    "matched case-insensitively; ambiguous text is refused with the candidate numbers listed. " +
    "Checking edits one character of one line — `- [ ]` becomes `- [x]` — so the item keeps its " +
    "text, its place in the list, and any comment anchored to it.",
  args: [
    {
      name: "list",
      required: true,
      description: "Todo document: its id, its title, or an unambiguous fragment of the title.",
    },
    {
      name: "item",
      required: true,
      description: "The item's 1-based number, or its text (case-insensitive).",
    },
  ],
  flags: [
    {
      name: "uncheck",
      type: "boolean",
      description: "Set `done: false` instead — put a completed item back on the list.",
    },
  ],
  examples: [
    {
      command: 'corpus todos check "Week of Jul 20" "Renew passport"',
      description: "Check the item off by its text.",
    },
    {
      command: 'corpus todos check "Week of Jul 20" 2 --json',
      description:
        'One JSON value: `{"docId":"doc_a1b2c3","index":1,"item":{"text":"Call plumber","done":true}}`.',
    },
  ],
  handler: async (context: PluginCommandContext): Promise<void> => {
    const list = resolveList(await fetchLists(context), context.args.get("list"));
    const index = resolveSelector(list.items, context.args.get("item"));
    const current = list.items[index];
    const done = !context.flags.boolean("uncheck");
    const result = await setDone(context, list.docId, index, done, current?.text ?? "");
    context.out.emit({ docId: result.docId, index: result.index, item: result.item });
    context.out.line(
      `${done ? "checked" : "unchecked"} item ${String(index + 1)} of ${list.title} [${
        list.docId
      }] — ${result.item?.text ?? current?.text ?? ""}`,
    );
  },
} satisfies PluginCommandSpec;
