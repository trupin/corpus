import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { migrateLists } from "../client.js";

/**
 * `corpus todos migrate` — move every pre-PLUGINS-005 todo list into its
 * document body.
 *
 * Until PLUGINS-005, items lived in an `items` frontmatter key; they are now
 * standard markdown task-list lines in the body (SPEC.md §12), which is what
 * makes each of them commentable, editable in the ordinary document view, and
 * visible when the plugin is not installed at all.
 *
 * This is the **convergence** half of the migration policy: writing to a list
 * through any other verb migrates that one list on the spot, but a list nobody
 * writes to again would otherwise keep its items in frontmatter forever — where
 * the document view no longer shows them. This verb converts all of them at
 * once, and running it again does nothing.
 */
export default {
  name: "migrate",
  summary: "Move todo lists from the old `items` frontmatter into their bodies.",
  description:
    "Converts every `type: todo` document that still stores its items in the `items` frontmatter " +
    "key — the pre-PLUGINS-005 format — into standard markdown task-list lines in its body, and " +
    "removes the stale key in the same commit. Archived lists are included. Idempotent: a " +
    "document already in the new format is left untouched and reported as unchanged, so running " +
    "this twice changes nothing. A document that cannot be converted safely — a hand-edited " +
    "`items` key that no longer parses, or one carrying items in both places — is reported as a " +
    "conflict with the reason and left exactly as it was, and the run carries on to the next " +
    "document. `--dry-run` reports the same answer without writing anything.",
  args: [],
  flags: [
    {
      name: "dry-run",
      type: "boolean",
      description:
        "Report exactly what a real run would convert and what it would skip, and write nothing. " +
        "The prediction comes from the same check that refuses a real write, so a document listed " +
        "as a conflict here is a document a real run refuses.",
    },
  ],
  examples: [
    {
      command: "corpus todos migrate --dry-run",
      description: "See what would move before anything does.",
    },
    {
      command: "corpus todos migrate",
      description: "Convert every remaining frontmatter-stored list; safe to re-run.",
    },
    {
      command: "corpus todos migrate --json",
      description:
        'One JSON value: `{"dryRun":false,"migrated":[{"docId":"doc_a1b2c3","title":"Week of Jul 20","items":3}],"conflicts":[],"unchanged":2}`.',
    },
  ],
  handler: async (context: PluginCommandContext): Promise<void> => {
    const dryRun = context.flags.boolean("dry-run");
    const result = await migrateLists(context, dryRun);
    context.out.emit(result);

    if (result.migrated.length === 0 && result.conflicts.length === 0) {
      context.out.line(
        `nothing to migrate — ${String(result.unchanged)} todo list${
          result.unchanged === 1 ? " already stores" : "s already store"
        } items in the body.`,
      );
      return;
    }
    for (const entry of result.migrated) {
      context.out.line(
        `${dryRun ? "would migrate" : "migrated"} ${entry.title} [${entry.docId}] — ${String(
          entry.items,
        )} item${entry.items === 1 ? "" : "s"} ${dryRun ? "to move" : "moved"} into the body`,
      );
    }
    for (const entry of result.conflicts) {
      context.out.line(
        `${dryRun ? "would skip" : "skipped"} ${entry.title} [${entry.docId}] — ${entry.reason}`,
      );
    }
    context.out.line(
      `${String(result.migrated.length)} ${dryRun ? "to migrate" : "migrated"} · ${String(
        result.conflicts.length,
      )} ${dryRun ? "to skip" : "skipped"} · ${String(result.unchanged)} already migrated`,
    );
    if (dryRun) context.out.line("nothing was written — re-run without --dry-run to convert.");
  },
} satisfies PluginCommandSpec;
