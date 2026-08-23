import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * The on-demand self-upgrade surface (SPEC.md §2.4) — what the UI's check
 * affordance reads, and what its "Upgrade & restart" action gets back.
 *
 * **On demand is the whole design, and it is visible in the shapes.** §2.4 opens
 * with the constraint: Corpus "never checks for, downloads, or installs anything
 * in the background, and never phones home". So nothing here is a cached fact
 * with an age, a `lastCheckedAt`, or a subscription — there is no state to
 * report, because no state is kept. {@link UpgradeCheckSchema} is the answer to
 * one request the operator asked for, and it is stale the moment it is returned.
 * A field like `checkedAt` would invite a client to remember it, and a
 * remembered check is a background check with extra steps.
 *
 * **The check reports two independent facts, not one.** `upgradeAvailable` is
 * the version comparison alone — a newer release exists. `verifiable` is whether
 * that release can actually be installed: §2.4 requires the upgrade to verify
 * "its published checksum", and INFRA-016 is what publishes it, as a
 * `corpus-<version>.tgz.sha256` asset beside the tarball. A release cut before
 * that asset existed is a real release with a real version number that the
 * upgrade will nonetheless **refuse**, because an unverified download is not
 * something Corpus installs. Folding the two into one boolean would leave a
 * client with no way to say which of the two things is true, and the difference
 * is the difference between "you are up to date" and "there is a newer version
 * you must install by hand".
 *
 * **The unreachable case is a described answer, not an error status.** GitHub is
 * an upstream this server does not control: rate limits, captive portals and
 * offline laptops are ordinary, not exceptional. `reachable` says whether the
 * release list was read at all, and it is separate from `latest === null`
 * because those are different facts — a distribution that has published no
 * release yet is reachable with no latest, and a rate-limited request is
 * unreachable, and a client that conflated them would tell an offline user that
 * Corpus has never shipped.
 *
 * **What is deliberately *not* modelled here: the workspace template sync.**
 * §2.4's second half has the upgrade bring the workspace's template files up to
 * the installed tool's, and requires conflicts to be reported "distinctly from
 * the things that merely happened". None of that is contract surface, and not
 * merely by scope: the three-way rule compares the sha `init` recorded, the sha
 * on disk, and **the sha the new tool ships** — and the new tool's files do not
 * exist in this workspace until the download and install have happened, which is
 * after this server has been replaced. A running server cannot compute the
 * incoming side, so a `templateChangesPending` field on the check would be a
 * guess. The report — conflicts included — is produced by the process that does
 * the work, and {@link UpgradeStartedSchema}'s `logPath` is how a client finds
 * it.
 */

export const UpgradeCheckSchema = openapi(
  z.object({
    installed: z
      .string()
      .min(1)
      .describe(
        "The version of the tool this server is running — the same value `GET /api/health` " +
          "reports as `version`. Always known, including when the check could not reach GitHub: " +
          "it is a fact about this process, not about the release list.",
      ),
    latest: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "The version of the newest published release of the installed distribution, exactly as " +
          "the GitHub Releases API named it. `null` when there is none to report — either the " +
          "check could not read the release list (`reachable` false) or the distribution has " +
          "published nothing yet (`reachable` true). Compared by the server, never by the client: " +
          "the comparison's verdict is `upgradeAvailable`, and a client that re-derived it from " +
          "these two strings would be writing a second version parser.",
      ),
    upgradeAvailable: z
      .boolean()
      .describe(
        "Whether `latest` is newer than `installed` — the version comparison and nothing else. " +
          "Always `false` when `latest` is `null`, because an unknown latest is not a newer one. " +
          "**Not sufficient on its own to offer an upgrade**: check `verifiable` too, or the " +
          "action offered here is one the upgrade will refuse.",
      ),
    verifiable: z
      .boolean()
      .describe(
        "Whether the release `latest` names publishes the checksum the upgrade verifies before " +
          "installing — the `corpus-<version>.tgz.sha256` asset, in `shasum -a 256` two-field " +
          "format, that the release workflow attaches beside the tarball (INFRA-016). §2.4 has " +
          "`corpus upgrade` verify the published checksum, so a release without one is not an " +
          "upgradable target and the upgrade refuses rather than installing unverified bytes. " +
          "`false` whenever `latest` is `null` — there is no asset list to have looked at. A " +
          "client seeing `upgradeAvailable` true and this `false` should say a newer release " +
          "exists and cannot be installed automatically, rather than offering an action that " +
          "will fail.",
      ),
    notesUrl: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "Absolute URL of the release notes for `latest` — the release's own page, for a client " +
          "to link so a person can read what is changing before accepting it. `null` whenever " +
          "there is no `latest`, and tolerated as `null` for a release that exposes no page. " +
          "Rendered as a link, never fetched by the client: this server is the only thing that " +
          "talks to GitHub, and it does so only when asked.",
      ),
    reachable: z
      .boolean()
      .describe(
        "Whether the GitHub Releases API answered. `false` is the modelled failure that §2.4's " +
          "on-demand check has to be able to report — an offline laptop, a captive portal, a " +
          "rate-limited API — and it arrives as a `200` carrying this flag, never as a `5xx`: " +
          "the endpoint did its job and the network is what did not. When `false`, `latest`, " +
          "`upgradeAvailable`, `verifiable` and `notesUrl` carry nothing (`null` / `false`) and " +
          "`detail` says why in one sentence.",
      ),
    detail: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "One human sentence about this answer when there is something to add — chiefly why an " +
          "unreachable check failed, but also why an available release is not verifiable, or " +
          "that the distribution has published no releases yet. **Rendered, never parsed**: the " +
          "wording is the server's and changes with the reason; every decision a client makes " +
          "comes from the booleans above. `null` when there is nothing to add, which is the " +
          "normal case for a workspace that is simply up to date. Nullable rather than optional " +
          "so that every key on this small object is always present, like the two nullable " +
          "fields beside it — one way to say 'nothing', not two.",
      ),
  }),
  "UpgradeCheck",
);

/**
 * The acknowledgement of a started upgrade — accepted, not completed.
 *
 * The server's whole part in an upgrade is `spawn`. §2.4 puts download,
 * checksum verification, reinstall through the detected npm-global path, the
 * workspace template sync, and the conditional restart in `corpus upgrade`,
 * running detached — and it *has* to run detached, because the last thing it
 * does is restart the very server that started it. So this response can report
 * only what is already true at the moment it is written: a process exists.
 *
 * **`started` is `literal(true)`, unlike the deliberately-boolean `appended` on
 * `AppendLogResult` and `unread` on the seen mark.** Those two relaxed to
 * booleans because a refusal is representable at the same status — a log line
 * dropped at the file cap is still a `201`. Here it is not: the one refusal the
 * trigger has, a second upgrade while one is in flight, is a `409` carrying the
 * house error envelope. A `started: false` would be a body no handler can
 * produce, and publishing an unreachable branch is how clients grow dead code.
 *
 * **`logPath` is the entire reporting channel, and that is the point.** §2.4
 * requires the upgrade to report what it updated, what it left alone, and — set
 * apart from both — every conflict, "listed distinctly from the things that
 * merely happened, so an agent running an upgrade can tell what it must still
 * act on without parsing prose". A conflict is unresolved work rather than a
 * notice. None of that can come back over this connection: it is produced
 * minutes later, by another process, across a server restart that drops the
 * client's SSE stream. Naming the file the detached process writes is therefore
 * not a convenience — it is the only thing that keeps the requirement reachable
 * from the HTTP surface at all, and it is what makes SERVER-050's "discoverable
 * path" literally discoverable rather than a path a client has to already know.
 */
export const UpgradeStartedSchema = openapi(
  z.object({
    started: z
      .literal(true)
      .describe(
        "Always `true`. The upgrade process was spawned; nothing here claims it will succeed, " +
          "and it has not finished — the response is written before the download begins. The " +
          "only other outcome of this call is the `409` refusal, so there is no `false` to send.",
      ),
    logPath: z
      .string()
      .min(1)
      .describe(
        "Workspace-relative path of the file the detached upgrade writes its output to, e.g. " +
          "`.corpus/upgrade.log` — workspace-relative, the spelling every path on this " +
          "surface uses. This is where SPEC.md §2.4's report lands: " +
          "what the tool install did, what the workspace template sync updated, what it left " +
          "alone, and — listed apart from all of that, because a conflict is unresolved work " +
          "rather than a notice — every file the workspace edited and the tool also changed, " +
          "each naming `corpus workspace diff <path>`. The connection this response arrives on " +
          "does not survive to carry any of it: the upgrade outlives the server it restarts. A " +
          "client that shows an upgrade as finished without pointing at this file has told the " +
          "operator less than the upgrade knows.",
      ),
  }),
  "UpgradeStarted",
);

export type UpgradeCheck = z.infer<typeof UpgradeCheckSchema>;
export type UpgradeStarted = z.infer<typeof UpgradeStartedSchema>;
