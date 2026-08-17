import { requireFlag, warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus thread designate` — give a conversation a resident (SPEC.md §7).
 *
 * A resident is a long-lived agent that owns this conversation *and everything
 * that grows out of it*, rather than being dispatched to one message at a time.
 * From here on, work falling in the thread's scope is enqueued on that scope's
 * lane instead of the orchestrator's — which is what `corpus queue idle
 * --thread` then parks on.
 *
 * **A user verb, and the server is what enforces that.** This does not pre-check
 * the actor, for the reason `doc detach` does not: an agent that could designate
 * would be choosing who answers a person's messages, and a second opinion here
 * about who may do what is a second place for the two to disagree. The `403` is
 * rendered like any other refusal, with the server's own sentence.
 *
 * **Every call means something, including one that changes nothing.** Designating
 * the resident a thread already has writes no file — the state asked for is the
 * state that holds — but still enqueues `resident.designated`, because that
 * event is how a person asks for a listener that is no longer running to be
 * launched again, and there is no other verb for it. So this verb never reports
 * "already designated": unlike `thread resolve`, a repeat is not a no-op, and
 * saying so would tell a person the one thing they came here to do had not
 * happened.
 *
 * The announcement lands on the **orchestrator's** lane whoever is designated —
 * a resident does not announce itself to itself — so it is the orchestrator's
 * loop that sees it and launches the listener.
 */
export async function runThreadDesignate(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const name = requireFlag(context, "agent", "name");

  const response = await context.client.request((api) =>
    api.POST("/api/threads/{id}/resident", { params: { path: { id } }, body: { name } }),
  );

  context.out.emit(response);

  // The server resolves the name to a `type: agent-def` document and answers
  // with both halves, so the printed line is the resolution rather than an echo
  // of what was typed — `--agent RESEARCHER` designating `researcher` should say
  // which document it landed on. A `200` always carries one; the fallback exists
  // so a server that somehow did not is reported as the caller's own spelling
  // rather than crashing on it.
  const resident = response.thread.resident;
  const who = resident === null || resident === undefined ? name : residentLabel(resident);
  context.out.line(`designated ${who} on ${id}${warningSuffix(response.warnings)}`);
}

function residentLabel(resident: { readonly name: string; readonly docId: string }): string {
  return `${resident.name} (${resident.docId})`;
}

export const designateCommand: WorkspaceCommandSpec = {
  name: "designate",
  summary: "Make an agent resident in a standalone conversation (user-only).",
  description:
    "Gives a **standalone** thread a resident: a long-lived agent that owns that conversation and " +
    "everything that grows out of it, rather than being dispatched to one message at a time " +
    "(SPEC.md §7). Work falling in the thread's **scope** is then enqueued on that scope's lane " +
    "instead of the orchestrator's, and the resident consumes it with `corpus queue idle " +
    "--thread <id>` and `corpus queue claim-all --thread <id>`. Scope membership is a walk, not a " +
    "label: nothing carries a scope marker, and the server works out at enqueue time whether an " +
    "event falls inside by following a thread's parents and a document's `origin`.\n\n" +
    "**`--agent` names the agent, not a document.** It is the same name `@<subagent>` mentions " +
    "resolve — a `type: agent-def` document's own name or its title, matched case-insensitively " +
    "— and the printed line reports the `{name, docId}` the server resolved it to, so nothing " +
    "has to repeat the lookup. A name that resolves to no agent-def here is the server's `404`.\n\n" +
    "**Single-valued, so designating again replaces**, and **a repeat is not a no-op**: even when " +
    "the thread already has this exact resident and no file is written, the designation is " +
    "announced again — which is how a person asks for a listener that is no longer running to be " +
    "launched. The announcement goes to the **orchestrator's** lane whoever is designated, since " +
    "a resident does not announce itself to itself.\n\n" +
    "**Refused for a thread that may not have one**: a thread with a parent — anchored or " +
    "whole-document — is the server's `409`, because a thread on a document is _about_ that " +
    "document and a resident owns a conversation rather than a passage. **User-only**: sending " +
    "this with `--from agent` is the server's `403`. Nothing already queued moves — a lane is " +
    "stamped once, at enqueue time — so designating does not re-route work the orchestrator is " +
    "already holding.",
  args: [{ name: "id", required: true, description: "The standalone thread's id." }],
  flags: [
    {
      name: "agent",
      type: "string",
      valueName: "name",
      description:
        "The agent to make resident, by the name `@<subagent>` mentions use — an `agent-def` " +
        "document's own name or its title, case-insensitively. Not a document id. Required: a " +
        "designation that names nobody is not one.",
    },
  ],
  examples: [
    {
      command: "corpus thread designate th_4b8e2c --agent researcher",
      description: "Put the researcher in charge of a conversation and everything it produces.",
    },
    {
      command: "corpus thread designate th_4b8e2c --agent researcher --json",
      description:
        'One JSON value — `{"thread":{…,"resident":{"name":"researcher","docId":"doc_r1"}},' +
        '"warnings":[]}` — the thread as it now stands, with the name resolved to the document ' +
        "that defines it.",
    },
  ],
  handler: (context) => runThreadDesignate(context),
};
