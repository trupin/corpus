import type { InvocationReport } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import type { Workspace } from "../workspace.js";

/**
 * The cost report going out (SPEC.md §9.4, CLI-085) — the one thing in this CLI
 * whose failure is a non-event.
 *
 * > _A report that fails to arrive costs the command nothing and is never
 * > retried: the measurements are advisory, and no verb's outcome may depend on
 * > the telemetry channel._ — SPEC.md §9.4
 *
 * Every decision below is that sentence read as an instruction.
 *
 * ## Awaited under a hard cap, not detached
 *
 * `bin/corpus.ts` sets `process.exitCode` and never calls `process.exit()` on
 * the normal path, so Node exits when the event loop drains. An un-awaited
 * `fetch` therefore **keeps the process alive until it settles**: detaching the
 * report would not make it free, it would only make its cost unmeasurable and
 * unbounded. So it is awaited, with {@link REPORT_TIMEOUT_MS} as the ceiling —
 * the latency is then a number this file states rather than a property of
 * whatever the server was doing.
 *
 * The common failures cost far less than the cap. A server that is not running
 * refuses the loopback connection immediately, and a server that is running
 * answers `204` without reading anything. The cap exists for the one case
 * neither of those covers: a server that accepts the connection and then stalls.
 *
 * ## It does not go through the shared client
 *
 * `client.ts` maps a refused connection to `ServerUnreachableError` — _"server
 * not running for this workspace — run `corpus server start`"_ — which is exit
 * code 4. That is the correct answer for a verb's own request and the wrong one
 * for this one, so the request is built here from the workspace's base URL and
 * token and that failure surface is **structurally** unable to reach it. There
 * is no `catch` that has to remember to be quiet.
 *
 * ## No retry, no spool, no output
 *
 * One attempt. Nothing is written to disk to be sent later: a durable spool
 * would give the channel the one property §9.4 defines it not to have, and it
 * would put a write path in a tool whose whole architecture is that the server
 * is the sole writer. Nothing is ever printed, in either mode — a warning about
 * a lost measurement would be the telemetry channel changing a command's output,
 * which is the failure this design exists to prevent.
 */

/**
 * How long the report may hold the process, in milliseconds.
 *
 * **50 ms**, chosen against the invocation's own cost rather than in the
 * abstract. `corpus health` on the packaged bundle costs ~159 ms end to end
 * (`startup-cost.test.ts`), so a pathological server can add at most a third of
 * one invocation before the command exits anyway — and the ordinary case is a
 * loopback POST the server answers without reading anything, which is a small
 * number of milliseconds.
 *
 * Lower would start discarding real reports on a busy machine, since the cap
 * covers the connection as well as the answer. Higher would let a stalled
 * server double a verb's latency for a measurement nobody is waiting for. The
 * budget CLI-085 sets is ~5 ms of *added* latency in the normal case, and it is
 * the normal case this number is not allowed to spoil.
 */
export const REPORT_TIMEOUT_MS = 50;

/**
 * The ingestion route, checked against the generated client's `paths` at compile
 * time — so renaming the route in the contract is a type error here rather than
 * a report that silently 404s for a release.
 */
const REPORT_PATH = "/api/telemetry/invocations" satisfies keyof paths;

export interface ReportDependencies {
  /** Defaults to global `fetch`. Injected by tests, never by the bin. */
  readonly fetch?: typeof globalThis.fetch;
  /** Defaults to {@link REPORT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Sends one invocation's measurement, or several, and **cannot fail**.
 *
 * Several go in the contract's batch form, which exists for exactly this: one
 * `corpus batch` process is several invocations, and each of them carries its
 * own `at`. An empty list sends nothing at all rather than an empty batch.
 *
 * The whole body is inside one `try`, the `catch` is empty by design, and the
 * response is not read: there is nothing a caller may act on, because §9.4
 * forbids any verb's outcome from depending on this call.
 */
export async function sendInvocationReports(
  workspace: Pick<Workspace, "baseUrl" | "token">,
  reports: readonly InvocationReport[],
  dependencies: ReportDependencies = {},
): Promise<void> {
  if (reports.length === 0) return;

  const send = dependencies.fetch ?? globalThis.fetch;
  const timeoutMs = dependencies.timeoutMs ?? REPORT_TIMEOUT_MS;
  const body = reports.length === 1 ? reports[0] : { invocations: reports };

  try {
    await send(`${workspace.baseUrl}${REPORT_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${workspace.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Deliberately empty, and deliberately not narrowed. A refused connection, a
    // timeout, a DNS failure, an aborted request and a body that would not
    // serialize are all the same event here: the measurement is gone, the
    // command is unaffected, and nothing is retried or printed (SPEC.md §9.4).
  }
}
