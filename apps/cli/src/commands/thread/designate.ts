import { UsageError } from "../../errors.js";
import { warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { GENERAL_RESIDENT, residentLabel } from "../resident.js";

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
 *
 * **Naming a profile is the refinement, not the act** (SPEC.md §7, rider
 * SHARED-048). `--agent` is optional: without it the conversation gets a general
 * resident, which §7 calls the ordinary case because it requires nothing to
 * exist in the workspace first — a workspace with no `agent-def` documents at
 * all can designate on its first day. Absence is spelled by sending no body, the
 * shape the contract chose so that the ordinary case costs a caller nothing to
 * express and cannot be confused with a release (that is the `DELETE`).
 */
export async function runThreadDesignate(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const name = resolveAgentName(context);

  const request = { params: { path: { id } } };
  const response = await context.client.request((api) =>
    api.POST(
      "/api/threads/{id}/resident",
      name === undefined ? request : { ...request, body: { name } },
    ),
  );

  context.out.emit(response);

  // The server resolves the name to a `type: agent-def` document and answers
  // with both halves, so the printed line is the resolution rather than an echo
  // of what was typed — `--agent RESEARCHER` designating `researcher` should say
  // which document it landed on, and a name whose document has since been
  // renamed, deleted, or moved out of `.claude/agents/` should say *that* rather
  // than a stale id. **Archiving is not one of those**: an archived `agent-def`
  // still under that root resolves exactly as before, and is still designatable,
  // so the line keeps printing its id. A `200` always carries a resident; the
  // fallback exists so a server that somehow did not is reported as what was
  // asked for rather than crashing on it.
  const resident = response.thread.resident;
  const who =
    resident === null || resident === undefined
      ? (name ?? GENERAL_RESIDENT)
      : residentLabel(resident);
  context.out.line(`designated ${who} on ${id}${warningSuffix(response.warnings)}`);
}

/**
 * `--agent <name>`, `--agent` omitted, or a blank — and the third is neither of
 * the first two.
 *
 * Omitting the flag is a **decision**: designate the workspace's ordinary agent.
 * `--agent ""` is a **mistake**: a variable that expanded to nothing, a name
 * that got lost in a shell. Reading the mistake as the decision would designate
 * something the caller never asked for and report success, so a blank is a usage
 * error (exit 2) and nothing is sent — the same refusal the server would make,
 * one round trip earlier and with a hint attached. It is also the same exit code
 * this verb has always given `--agent ""`, back when every designation had to
 * name somebody.
 */
function resolveAgentName(context: WorkspaceCommandContext): string | undefined {
  const name = context.flags.string("agent");
  if (name === undefined) return undefined;
  if (name.trim() === "") {
    throw new UsageError("--agent was given without an agent name.", {
      hint:
        "Name the profile to make resident — `--agent researcher` — or leave the flag out " +
        "entirely to designate a general resident, an agent with no profile. A blank is neither " +
        "of those, and nothing was sent to the server.",
    });
  }
  return name;
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
    "**`--agent` is optional, and which you want is a one-line question**: leave it out when the " +
    "workspace's ordinary agent should own the conversation, and name a profile when it should be " +
    "owned by an agent that behaves differently from the default. Designating without it gives " +
    "the thread a _general resident_ — an agent with no profile document — which needs nothing to " +
    "exist in the workspace first, so a workspace with no `agent-def` documents can designate on " +
    "its first day. Everything else is identical either way: the lane, the scope, presence, the " +
    "lapse fallback, and release.\n\n" +
    "**`--agent` names the agent, not a document.** It is the same name `@<subagent>` mentions " +
    "resolve — for a `type: agent-def` document **under `.claude/agents/`**, either its filename " +
    "stem or its title, matched case-insensitively, and the two routinely differ, since a persona " +
    "created with a title of `Legacy Analyst` is written to `legacy-analyst.md` — and the printed " +
    "line reports the `{name, docId}` the server resolved it to, so nothing has to repeat the " +
    "lookup. **An `agent-def` filed outside that root answers to neither spelling** (the " +
    "`--type agent-def --folder inbox` form of `corpus doc create`): it is a document _about_ a " +
    "persona, nothing loads it as a subagent, and naming it here is a `404`. Where an off-root " +
    "`agent-def` is titled the name given, that `404` names its path, because moving the file " +
    "into `.claude/agents/` is what makes it designatable; off root there is no filename stem to " +
    "answer to, so `--agent legacy-analyst` for a document titled `Legacy Analyst` in the inbox " +
    "is the bare refusal — try its title to be told where it is. A " +
    "name that resolves to no agent-def here is likewise the server's `404`: a " +
    "typo is refused rather than quietly downgraded to a general resident. A **blank** name " +
    '(`--agent ""`) is a usage error and nothing is sent — dropping a name by accident is a ' +
    "mistake, while asking for no profile is a decision, and the two must not look alike. Where " +
    "a profile has since been renamed, deleted, or moved out of `.claude/agents/`, the residency " +
    "stands, and the printed line reports `name (profile missing)` rather than substituting " +
    "anything for it. **Archiving is not one of those**: an archived `agent-def` still under that " +
    "root resolves exactly as before, and is still designatable, so the line keeps printing its " +
    "id.\n\n" +
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
        "The **profile** to make resident, by the name `@<subagent>` mentions use — for an " +
        "`agent-def` document **under `.claude/agents/`**, its filename stem or its title, " +
        "case-insensitively. Not a document id, and not an `agent-def` filed anywhere else: one " +
        "under `data/docs/` is a document _about_ a persona, answers to neither spelling, and is " +
        "a `404` here — one that names the file's path when the name given is that document's " +
        "**title**, and a bare refusal when it is the filename stem, which off root is nobody's " +
        "alias. " +
        "**Optional**: omit it when the workspace's ordinary agent should own this conversation, " +
        "and name a profile when it wants an agent that behaves differently from the default. A " +
        "blank name is a usage error rather than absence.",
    },
  ],
  examples: [
    {
      command: "corpus thread designate th_4b8e2c",
      description:
        "Put an agent in charge of a conversation and everything it produces, without choosing a " +
        "profile for it — prints `designated a general resident on th_4b8e2c`.",
    },
    {
      command: "corpus thread designate th_4b8e2c --agent researcher",
      description:
        "The same, owned by the researcher's profile — prints the `agent-def` document the name " +
        "resolved to, so nothing has to repeat the lookup.",
    },
    {
      command: "corpus thread designate th_4b8e2c --json",
      description:
        'One JSON value — `{"thread":{…,"resident":{"name":null,"docId":null}},"warnings":[]}` — ' +
        "the thread as it now stands. Both fields null is a general resident; `name` set with " +
        "`docId` null is a profile that has since been renamed, deleted, or moved out of " +
        "`.claude/agents/` — never one merely archived, which still resolves to its id; the whole " +
        "`resident` null is a thread that has none.",
    },
  ],
  handler: (context) => runThreadDesignate(context),
};
