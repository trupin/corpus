import { createRoute } from "@hono/zod-openapi";
import { UpgradeCheckSchema, UpgradeStartedSchema } from "../schemas/upgrade.js";
import { CONFLICT_RESPONSE, jsonContent, UNAUTHORIZED_RESPONSE } from "./responses.js";

/**
 * The UI's half of SPEC.md §2.4 — a check affordance, and an "Upgrade &
 * restart" action that "asks the server to spawn the detached CLI upgrade".
 *
 * **Two routes, because §2.4 describes two acts and refuses to merge them.**
 * Checking is read-only and side-effect free; upgrading downloads, verifies,
 * reinstalls, syncs the workspace template and restarts a server. A single
 * endpoint that checked and then acted would make it impossible to look without
 * committing, which is precisely the affordance the spec's "on demand" posture
 * exists to give a person.
 *
 * **Neither route carries an acting party**, and unlike the pair in
 * `./index-maintenance.ts` the reason is not that nothing is written. Something
 * very much is: §2.4 has the upgrade write the workspace's template files and
 * land them in "a single attributed commit". The reason is *who* writes. This
 * server's entire contribution is `spawn`; the writes and the commit happen in
 * another process, minutes later, after the download, and quite possibly after
 * this server has been stopped and replaced — the upgrade restarts it, so it
 * must outlive it. `x-corpus-author` exists so a header becomes the git author
 * of the commit a request makes (§9.2), and this request makes no commit. A
 * header here would be a promise the server cannot keep and the committing
 * process is not bound by, so the contract declines to publish an input nothing
 * reads. It stays additive if a future revision wants the trigger to attribute.
 *
 * The same absence is why the trigger is a **bodiless** `POST`: with no body, no
 * query and no headers, neither route validates request input, and so neither
 * declares a `400` — matching every other input-free operation in the document.
 *
 * **What is deliberately *not* here.**
 * - *A cancel or status endpoint.* There is nothing coherent to poll: the
 *   upgrade's own last act is restarting the server that would answer. §2.4
 *   gives the UI its progress signal already — "the UI rides out the restart
 *   with its normal SSE reconnect and shows the new version on return" — so the
 *   connection dropping *is* the progress indicator, and `GET /api/health`'s
 *   `version` on return is the completion signal. A polling endpoint would have
 *   to lie across exactly the window it exists to cover.
 * - *A route for the workspace template sync.* §2.4 makes it part of `corpus
 *   upgrade`, not a thing to be asked for separately, and `corpus workspace
 *   upgrade` is one of SPEC.md §2.2 rule 4's bootstrap-class exceptions to the
 *   sole-writer rule — it must work with the server stopped, because a workspace
 *   whose skills are broken is the workspace whose loop cannot be asked to fix
 *   them. Routing it through the server would break that guarantee to gain
 *   nothing.
 */

export const checkUpgrade = createRoute({
  method: "get",
  path: "/api/upgrade/check",
  tags: ["upgrade"],
  summary: "Ask, once, whether a newer release exists",
  description:
    "Queries the GitHub Releases API for the newest release of the installed distribution and " +
    "compares it with the running version (SPEC.md §2.4). **Only when called** — Corpus 'never " +
    "checks for, downloads, or installs anything in the background, and never phones home', so " +
    "this endpoint is the *only* thing that reaches GitHub, it reaches it once per request, and " +
    "it keeps nothing between requests. There is no cache to invalidate and no schedule to " +
    "disable, because there is neither.\n\n" +
    "**Read-only in the strictest sense**: nothing is downloaded, nothing is written, no commit " +
    "is made, and no acting party is declared. Calling it a hundred times changes nothing but " +
    "the rate-limit budget.\n\n" +
    "**Two independent verdicts, not one.** `upgradeAvailable` is the version comparison; " +
    "`verifiable` is whether that release publishes the checksum asset §2.4 requires the upgrade " +
    "to verify before installing. A newer release without one is not an upgradable target — " +
    "`POST /api/upgrade` would start an upgrade that refuses — so a client offers its action on " +
    "both flags, and explains rather than acts when they disagree.\n\n" +
    "**An unreachable GitHub is a described answer, never a `5xx`.** Offline laptops, captive " +
    "portals and rate limits are ordinary conditions for a localhost tool, not server faults: " +
    "the response is a `200` with `reachable` false, the other fields empty, and `detail` saying " +
    "why in one sentence. The endpoint succeeded; the network is what did not.\n\n" +
    "**It reports nothing about the workspace's template files**, though §2.4's upgrade syncs " +
    "them. It cannot: the three-way rule compares against the files the *new* tool ships, and " +
    "those are not in this workspace until the install has happened. `corpus upgrade --check` " +
    "answers that question locally, after it has resolved the incoming side.",
  responses: {
    200: jsonContent(
      UpgradeCheckSchema,
      "What the check found — including the honest 'I could not look', which is `reachable` " +
        "false rather than an error status.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const startUpgrade = createRoute({
  method: "post",
  path: "/api/upgrade",
  tags: ["upgrade"],
  summary: "Spawn the detached CLI upgrade, and answer before it finishes",
  description:
    "Asks the server to spawn the installed `corpus upgrade` as a detached process — the UI's " +
    "'Upgrade & restart' action (SPEC.md §2.4). The server performs no part of the upgrade " +
    "itself: the spawned CLI checks, downloads the tarball over HTTPS, verifies its published " +
    "checksum, reinstalls through the same npm-global path the tool was installed with (refusing " +
    "with instructions rather than guessing when the install method cannot be detected), brings " +
    "the workspace's template files up to the new tool's, and — if and only if the server was " +
    "running when the upgrade began — restarts it against the same workspace.\n\n" +
    "**Takes no request body at all**, and carries no acting party: this request writes no " +
    "workspace file and makes no commit. The writes and the single attributed commit belong to " +
    "the spawned process, which outlives this one by design (it restarts the server, so it " +
    "cannot be the server's child in any surviving sense).\n\n" +
    "**`202`, and the gap it names is real.** The response is written before the download " +
    "begins; it reports that a process exists and nothing more. Success, refusal-to-install and " +
    "every template-sync verdict are decided long afterwards, and none of them can come back " +
    "over this connection — which is why the body names `logPath`, the file the detached process " +
    "writes its report to. That report is where SPEC.md §2.4's requirement lands: what was " +
    "updated, what was left alone, and, listed apart from both because **a conflict is " +
    "unresolved work rather than a notice**, every file the workspace edited that the tool also " +
    "changed, each naming `corpus workspace diff <path>`. Corpus never merges those " +
    "automatically — a plausible-looking auto-merge of prose that instructs the agent would " +
    "corrupt the loop.\n\n" +
    "**Completion is observed, not reported.** §2.4: the UI 'rides out the restart with its " +
    "normal SSE reconnect and shows the new version on return'. The `/events` stream dropping is " +
    "the upgrade proceeding; the stream returning with a new `version` from `GET /api/health` is " +
    "it having finished. There is deliberately no progress endpoint, because the only server " +
    "that could answer one is the server being replaced.\n\n" +
    "**One at a time.** A second trigger while an upgrade is in flight is a `409`, not a second " +
    "process: two concurrent installs racing over the same npm prefix is how a working " +
    "installation becomes a broken one.",
  responses: {
    202: jsonContent(
      UpgradeStartedSchema,
      "Spawned, not completed. `started` is always `true` — the refusal has its own status — and " +
        "`logPath` is where the upgrade's report, conflicts included, will be written.",
    ),
    401: UNAUTHORIZED_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});
