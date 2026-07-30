import { ACTOR_HEADER } from "@corpus/contract";
import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { z } from "zod";

/**
 * `corpus _fixture add <title>` — the fixture's one CLI verb (SPEC.md §10).
 *
 * Discovered by the CLI's registry scanner and wrapped into a `_fixture`
 * topic; the shape below is the same declarative command shape core verbs use
 * (description, args, flags, ≥1 example, handler), typed from
 * `@corpus/contract/plugin` (CONTRACT-015) — the types-only subpath a plugin
 * is allowed to import, which `apps/cli`'s registry aliases so plugin verbs
 * and core verbs are validated by one set of rules. `satisfies` is what makes
 * a malformed spec a compile error here rather than a load-time warning that
 * silently drops the verb. The handler is a thin HTTP client like every other
 * verb: one POST to the plugin's own server route, no filesystem, no git.
 */

const CreatedSchema = z.object({ id: z.string(), title: z.string() });

export default {
  name: "add",
  summary: "Create a fixture note through the plugin's server route.",
  description:
    "Test-only: proves a plugin CLI verb reaches the server's `/api/x/_fixture` routes and " +
    "that the write lands through the core write path (commit, projection, SSE).",
  args: [{ name: "title", required: true, description: "Title of the fixture note." }],
  flags: [],
  examples: [
    {
      command: 'corpus _fixture add "Try the fixture"',
      description: "Create a fixture note titled “Try the fixture”.",
    },
  ],
  handler: async (context: PluginCommandContext): Promise<void> => {
    const response = await fetch(`${context.workspace.baseUrl}/api/x/_fixture/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.workspace.token}`,
        "content-type": "application/json",
        [ACTOR_HEADER]: context.actor,
      },
      body: JSON.stringify({ title: context.args.get("title") }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`POST /api/x/_fixture/notes failed (HTTP ${String(response.status)})`);
    }
    const created = CreatedSchema.parse(payload);
    context.out.emit(created);
    context.out.line(`created fixture note ${created.id} — ${created.title}`);
  },
} satisfies PluginCommandSpec;
