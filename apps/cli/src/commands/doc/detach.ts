import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc detach` — take a document out of the conversation it was filed
 * into (SPEC.md §9.2, CLI-044).
 *
 * **A correction, not a lock.** §9.2 is explicit that a detached document may be
 * claimed again by a later write that names a job, so this undoes a filing
 * rather than sealing the document against being filed. A document that must
 * stay out of every scope stays out by nobody writing it from a job — there is
 * no flag here that would make it permanent, because the spec does not offer
 * one.
 *
 * **User-only, and the server is what enforces it.** An agent that could detach
 * could quietly move an artifact out of the scope it belongs to, which is the
 * one thing the origin mechanism exists to prevent. The refusal is the server's
 * `403`; this verb does not pre-check the actor, for the same reason it does not
 * pre-check the job id — a second opinion about who may do what is a second
 * place for the two to disagree.
 *
 * It sends `origin: null` on the ordinary document edit rather than having a
 * route of its own: detaching *is* an edit, and §9.2 gives it the one exception
 * in the edit's shape rather than a verb in the API.
 */
export async function runDocDetach(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const response = await context.client.request((api) =>
    api.PUT("/api/docs/{id}", {
      params: { path: { id } },
      body: { origin: null },
    }),
  );

  context.out.emit(response);
  context.out.line(`detached ${id} — it now belongs to no conversation`);
}

export const detachCommand: WorkspaceCommandSpec = {
  name: "detach",
  summary: "Clear a document's origin, taking it out of its conversation (user-only).",
  description:
    "Clears `origin`, so the document leaves the scope of the conversation it was filed into " +
    "(SPEC.md §7, §9.2). Use it when a write attributed a document to the wrong job — the " +
    "artifact stays exactly where it is, and only its membership changes.\n\n" +
    "**User-only.** An agent sending this is refused with `403`: detaching is a person's " +
    "correction of where their own work was filed, and an agent able to undo it could move an " +
    "artifact out of a scope unseen. **A correction rather than a lock** — a later write that " +
    "names a job may claim the document again, so this does not seal it. A document that must " +
    "stay unfiled stays unfiled by nobody writing it from a job.\n\n" +
    "An origin is never _set_ from here, or from anywhere else a caller can reach: the server " +
    "records it from the `job` a write names, which is why `--job` exists on the writing verbs " +
    "and no `--origin` exists anywhere.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus doc detach doc_a1b2c3",
      description: "Take a document out of the conversation a job filed it into.",
    },
  ],
  handler: (context) => runDocDetach(context),
};
