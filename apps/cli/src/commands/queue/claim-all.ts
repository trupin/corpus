import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { reportInProgress } from "./in-progress.js";
import { CLAIM_ALL_LANE_FLAG, resolveLaneScope } from "./lane.js";

/**
 * The atomic step of the agent loop (SPEC.md §7). Its **stdout** is deliberately
 * identical in both modes — the batch *is* the payload, and a human-readable
 * variant would be a different command — so it writes through `out.write`
 * rather than `out.emit`, which only speaks under `--json`.
 *
 * That invariant is why the in-progress set's human rendering goes to stderr
 * (`out.note`) rather than being appended here: the orchestrate skill runs the
 * bare verb and parses stdout, and one line of prose would break it. The set
 * itself rides along inside the batch in both modes — it is the contract's own
 * `inProgress` key, passed through untouched — so `--json` keeps the instants
 * and the overflow pair intact for the agent to branch on.
 *
 * **The lane changes what is claimed and nothing about the shape of it**
 * (SPEC.md §7). A `--thread` claim takes that lane's pending events; the
 * unscoped claim takes the orchestrator's, plus every lane whose listener is not
 * there — so a scoped empty batch and an unscoped empty batch print the same
 * `{"events":[],…}` line, and neither is a failure.
 */
export async function runClaimAll(context: WorkspaceCommandContext): Promise<void> {
  const scope = resolveLaneScope(context.flags);
  const batch = await context.client.request((api) =>
    // An absent lane is an omitted parameter, not `scope: undefined`: the server
    // reads the orchestrator's lane from silence, and spelling it out would give
    // that lane the second name `lane.ts` exists to refuse.
    api.POST("/api/queue/claim-all", scope === undefined ? {} : { params: { query: { scope } } }),
  );
  if (context.out.json) {
    context.out.emit(batch);
  } else {
    context.out.write(`${JSON.stringify(batch)}\n`);
  }
  reportInProgress(context.out, batch.inProgress);
}

export const claimAllCommand: WorkspaceCommandSpec = {
  name: "claim-all",
  summary: "Claim every pending event as one batch.",
  description:
    "Moves all `pending/*` events to `in-progress/` in a single call and prints them as **one " +
    "JSON line on stdout, in both human and `--json` mode** — no prose, no summary line, no " +
    "pretty-printing, and no pagination however large the batch. This command exists for machine " +
    "consumption and the batch is the payload; do not add a human-readable line to stdout. An " +
    "empty batch is still a batch: `events` is `[]` and the exit code is 0, which is the normal " +
    "outcome when another idle client claimed first or the queue is halted. Concurrent claims " +
    "never hand the same event to two callers.\n\n" +
    "**The response also reports what the server still thinks you are doing** (SPEC.md §7). " +
    "Alongside `events` it carries `inProgress`, the events already sitting in `in-progress/` " +
    "when the call arrived — **a different list from the one you just claimed, and never mixed " +
    "into it**. Each row gives the event's id and type, the document or thread it came from, and " +
    "`heldSince` as an ISO instant so you compute its age against your own clock. The list is " +
    "capped at the 20 most recently claimed and says so rather than trailing off: `total` is how " +
    "many are really held and `truncated` is true when the cap bit. Read it and reconcile — " +
    "settle what you have already done with the ordinary verbs, leave what you are still " +
    "working, and never settle an event you cannot account for. Nothing here is claimed, and the " +
    "server settles none of it by itself.\n\n" +
    "In human mode that same list is also printed as a readable block **on stderr** — ages as " +
    "`held 3h`, one row per event, with an explicit _and N more held_ line when the cap bit — so " +
    "stdout stays the single JSON line a pipe can parse. Under `--json` the block is suppressed " +
    "and stderr carries only failures. Either way nothing at all is printed when nothing is held.\n\n" +
    "**A claim takes a lane** (SPEC.md §7). `--thread` claims that conversation's lane and only " +
    "it; omitting the flag is the orchestrator's claim, which takes its own lane **plus every " +
    "lane nobody is listening on** — so two agents claiming at once read disjoint sets rather " +
    "than racing for one event. Picking up the work of a lane whose listener is absent is the " +
    "ordinary intended outcome and not a fault to report: that work is then done by the " +
    "orchestrator, more slowly and without the conversation's warmth, and never silently not " +
    "done. The output shape is identical either way, empty batch included.",
  args: [],
  flags: [CLAIM_ALL_LANE_FLAG],
  examples: [
    {
      command: "corpus queue claim-all",
      description:
        'One JSON line: `{"events":[{"id":"evt_…","type":"comment.created",…}],"inProgress":{"events":[],"total":0,"truncated":false}}`.',
    },
    {
      command: "corpus queue claim-all | jq -r '.events[].id'",
      description: "Drive a loop over the claimed event ids.",
    },
    {
      command: "corpus queue claim-all | jq '.inProgress'",
      description:
        "Inspect only what the server still holds — `total` and `truncated` say whether the list " +
        "you are looking at is the whole of it.",
    },
    {
      command: "corpus queue claim-all --thread th_4b8e2c",
      description:
        "A resident's claim: only its own conversation's lane, never the orchestrator's and never " +
        "another lane's.",
    },
  ],
  handler: (context) => runClaimAll(context),
};
