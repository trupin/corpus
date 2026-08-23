import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, ServerResponseError, UsageError } from "../../errors.js";
import { gloss } from "../../gloss.js";
import { renderCommandHelp, renderTopicHelp } from "../../help.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { queueTopic } from "./index.js";
import {
  abandonCommand,
  completeCommand,
  failCommand,
  runAbandon,
  runComplete,
  runFail,
} from "./transitions.js";

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-27T10:00:00.000Z",
  source: "ui",
  payload: { threadId: "th_2222" },
};

const ARGS = { "event-id": "evt_1111" };

afterEach(closeStubServers);

describe("queue transitions", () => {
  it("completes through the contract's path and reports the state, not the move", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS });
    await runComplete(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111/complete");
    // `QueueEvent` has no status, so the CLI cannot claim it moved the event and
    // reports the state instead.
    expect(harness.stdout()).toBe("event evt_1111 is complete.\n");
  });

  /**
   * The line is a report on the event's state, not a claim about this call. That
   * is still true and still worth pinning — `QueueEvent` carries no status, so
   * the CLI could not claim the move even if it wanted to. What is no longer
   * true is the reason this test used to give: since SERVER-145 a second
   * `complete` is a `409`, so two 200s in a row is a stub arrangement rather
   * than something the server will do.
   */
  it("reports the state rather than the transition, for any accepted call", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const first = stubContext(stub, { args: ARGS });
    await runComplete(first.context);
    const second = stubContext(stub, { args: ARGS });
    await runComplete(second.context);

    expect(second.stdout()).toBe(first.stdout());
    expect(first.stdout()).not.toContain("completed");
  });

  /**
   * CLI-067. `complete` is not idempotent any more, and the CLI's job is to
   * carry the server's refusal through at exit 5 rather than soften it.
   */
  it("carries a repeated complete's 409 through at exit 5 with an empty stdout", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 409, {
        code: "conflict",
        message: "queue event evt_1111 is already processed",
      });
    });

    const harness = stubContext(stub, { args: ARGS });
    const error: unknown = await runComplete(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(harness.stdout()).toBe("");
  });

  it("emits the event verbatim under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runComplete(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(EVENT);
  });

  it("sends the reason when one is given", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runFail(stubContext(stub, { args: ARGS, flags: { reason: "hook rejected" } }).context);

    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111/fail");
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ reason: "hook rejected" });
  });

  it("trims the reason it sends, so a stray newline never reaches the failed row", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    await runFail(stubContext(stub, { args: ARGS, flags: { reason: "  disk full\n" } }).context);

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ reason: "disk full" });
  });

  /**
   * CLI-067's central assertion, and the reason it asserts **zero** requests
   * rather than a non-zero exit: a test that only checked the exit code would
   * pass if the request went out and the server refused it, which is exactly the
   * behaviour this replaces. The refusal has to happen before the round trip, or
   * a failed row with nothing to say why is still reachable through a caller
   * that ignores exit codes.
   *
   * `--reason ""` is refused with the missing case: a caller who typed an empty
   * string has not given a reason by any reading, and the wire would answer
   * `400` for it anyway (`reason` is `min(1)`).
   */
  it.each([
    ["absent", {}],
    ["empty", { reason: "" }],
    ["only spacing", { reason: "   " }],
  ])("refuses a --reason that is %s without sending a request", async (_case, flags) => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags });
    const error: unknown = await runFail(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(error instanceof UsageError ? error.message : "").toContain("--reason");
    expect(stub.requests).toEqual([]);
    expect(harness.stdout()).toBe("");
  });

  /** The hint points at the verb that exists for "nothing to add". */
  it("names abandon in the hint, so the refusal is not a dead end", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS, flags: {} });
    const error: unknown = await runFail(harness.context).catch((cause: unknown) => cause);

    expect(error instanceof UsageError ? (error.hint ?? "") : "").toContain("corpus queue abandon");
  });

  it("abandons with a DELETE, which moves rather than deletes", async () => {
    const stub = await startStubServer(jsonResponder(200, EVENT));

    const harness = stubContext(stub, { args: ARGS });
    await runAbandon(harness.context);

    expect(stub.requests[0]?.method).toBe("DELETE");
    expect(stub.requests[0]?.path).toBe("/api/queue/evt_1111");
    expect(harness.stdout()).toBe("event evt_1111 is abandoned.\n");
  });

  it("maps an unknown event id to exit 5 with an empty stdout", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no such event" });
    });

    const harness = stubContext(stub, { args: { "event-id": "evt_zzzz" } });
    const error: unknown = await runComplete(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(harness.stdout()).toBe("");
  });
});

/**
 * CLI-067's last acceptance criterion, and the one the issue's own wording would
 * have sent an implementer past.
 *
 * The issue says brief help is "the first sentence of each description". That is
 * true of a **flag** and an **argument** (`gloss.ts`, CLI-056) and false of a
 * **command**: `renderCommandHelp` drops `description` wholesale in brief
 * (`help.ts`), so what a brief reader gets for a verb is its `summary` and the
 * glosses of its flags — no sentence of the description at all. A correction
 * written as the description's *first* sentence would still have been invisible.
 *
 * So the rule lives in the `summary`, and these tests check both registers. The
 * assertions are negative as well as positive: the old text was not merely
 * incomplete, it said the opposite, and prose that still contains it is worse
 * than prose that omits it.
 */
describe("the help these verbs publish matches what the server now does", () => {
  const plain = { color: false, topic: "queue" } as const;
  const brief = { color: false, mode: "brief", topic: "queue" } as const;

  it("no longer promises idempotence anywhere in the queue surface", () => {
    const surface = [
      renderCommandHelp(completeCommand, plain),
      renderCommandHelp(failCommand, plain),
      renderCommandHelp(abandonCommand, plain),
      renderTopicHelp(queueTopic, { color: false }),
    ].join("\n");

    expect(surface).not.toContain("already-completed event is not an error");
    expect(surface).not.toContain("exits 0 like the");
    expect(surface).not.toContain("every transition is idempotent");
  });

  it("puts the claim rule in complete's brief register, not only its full text", () => {
    const short = renderCommandHelp(completeCommand, brief);
    expect(short).toContain("completing anything else is refused");
    expect(renderCommandHelp(completeCommand, plain)).toContain(
      "Only claimed work can be completed",
    );
  });

  it("puts the required flag in fail's brief register, in the summary and the gloss", () => {
    const short = renderCommandHelp(failCommand, brief);
    // The summary line, which is the whole of what brief says about the verb.
    expect(short).toContain("saying why in the required --reason");
    expect(renderCommandHelp(failCommand, plain)).toContain("is a usage error");
  });

  it("states abandon's one refused state in brief, where it differs from the other two", () => {
    expect(renderCommandHelp(abandonCommand, brief)).toContain("from any state but processed");
    expect(renderCommandHelp(abandonCommand, plain)).toContain("not** restricted to claimed work");
  });

  it("offers no example that would now be refused", () => {
    for (const example of failCommand.examples) {
      expect(example.command, example.command).toContain("--reason");
    }
  });

  /**
   * Found by rendering the real binary's brief help rather than by a unit test,
   * which is why the E2E step is not a formality. `--reason`'s description opened
   * `**Required.**` as its own sentence, so `gloss()` cut there and the brief
   * reader got the single word "Required" with nothing about what to write. The
   * pre-existing `--blocked-on` on `queue defer` had the identical shape.
   *
   * The rule is not "never write Required" — it is that a gloss must survive
   * alone, and a first sentence containing only a requirement marker does not.
   */
  it("gives every required queue flag a gloss that says more than the word Required", () => {
    const marker = /^\W*required\W*$/i;
    const offenders: string[] = [];
    for (const command of queueTopic.commands) {
      for (const flag of command.flags) {
        if (marker.test(gloss(flag.description))) {
          offenders.push(`queue ${command.name} --${flag.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the requirement itself visible in fail's brief flag list", () => {
    const short = renderCommandHelp(failCommand, brief);
    expect(short).toContain("**Required**");
    expect(short).toContain("why the event failed");
  });

  /** The sibling the audit predicted: a topic paragraph carrying the same claim. */
  it("corrects the topic paragraph, which made the claim for all four verbs at once", () => {
    const topic = renderTopicHelp(queueTopic, { color: false });
    expect(topic).toContain("a settle is only ever accepted from the agent that claimed the work");
    expect(topic).toContain("conflict (exit 5)");
  });
});
