import { warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { residentLabel } from "../resident.js";

/**
 * `corpus thread release` — dissolve a conversation's residency (SPEC.md §7).
 *
 * The scope returns to ordinary routing and nothing is rewritten: events already
 * stamped keep the lane they were stamped with, so releasing strands no work.
 * Dissolving is the **absence** of a resident and never a third state.
 *
 * **Idempotent, and it says which of the two happened.** The route answers with
 * the thread either way and its response cannot distinguish a release that wrote
 * from one that had nothing to write — `resident` is null in both. So the thread
 * is read first, purely to report what was released instead of claiming a change
 * that did not happen. That is exactly `thread resolve`'s pre-read and exists
 * for the same reason: the caller often cannot know, and the loop must never
 * have to branch on it.
 *
 * **User-only, enforced by the server.** No client-side actor check, matching
 * `designate` and `doc detach`: an agent able to release could quietly stop
 * being resident in a conversation a person put it in, and the `403` says so in
 * the server's own words.
 */
export async function runThreadRelease(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const before = await context.client.request((api) =>
    api.GET("/api/threads/{id}", { params: { path: { id } } }),
  );
  const departing = before.resident;

  const response = await context.client.request((api) =>
    api.DELETE("/api/threads/{id}/resident", { params: { path: { id } } }),
  );

  context.out.emit(response);
  const suffix = warningSuffix(response.warnings);
  context.out.line(
    departing === null || departing === undefined
      ? `${id} had no resident — nothing to release${suffix}`
      : // The shared label, so that releasing a resident designated with no
        // profile says so rather than printing its null `name` (SHARED-048).
        `released ${residentLabel(departing)} from ${id}${suffix}`,
  );
}

export const releaseCommand: WorkspaceCommandSpec = {
  name: "release",
  summary: "Release a conversation's resident agent (user-only).",
  description:
    "Releases the thread's resident, returning its scope to ordinary routing (SPEC.md §7): later " +
    "events in that conversation are enqueued on the orchestrator's lane again, as they were " +
    "before there was a resident. **Nothing is rewritten** — events already stamped keep the lane " +
    "they were stamped with, so releasing strands no queued work — and dissolving is the absence " +
    "of a resident, never a third state.\n\n" +
    "**Idempotent.** Releasing a thread that has nobody resident writes nothing, commits nothing " +
    "and announces nothing; it reports _nothing to release_ and exits 0. A real release rewrites " +
    "the thread's frontmatter and commits it, so any SPEC.md §11 warning that commit raises is " +
    "appended to the printed line.\n\n" +
    "**Resolving a thread already does this** (SPEC.md §7): a settled conversation has nobody to " +
    "keep resident, so `corpus thread resolve` releases as part of resolving — and **reopening " +
    "does not bring the resident back** (§8). Designating again is a deliberate act, as the first " +
    "designation was.\n\n" +
    "**User-only**: sending this with `--from agent` is the server's `403`. Releasing is the " +
    "other half of the same user-only state as designating, and an agent able to release could " +
    "quietly stop being resident in a conversation a person put it in.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [],
  examples: [
    {
      command: "corpus thread release th_4b8e2c",
      description:
        "Hand the conversation back to ordinary routing; prints who was released, or that there " +
        "was nobody.",
    },
    {
      command: "corpus thread release th_4b8e2c --json",
      description:
        'One JSON value — `{"thread":{…,"resident":null},"warnings":[]}` — the thread as it now ' +
        "stands, alongside any warning the commit raised.",
    },
  ],
  handler: (context) => runThreadRelease(context),
};
