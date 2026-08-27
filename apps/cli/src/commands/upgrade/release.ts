/**
 * The release lookup moved to `@corpus/contract` (CONTRACT-090).
 *
 * It did not move because the CLI stopped needing it. It moved because a second
 * caller appeared — `GET /api/upgrade/check`, which publishes this judgment to
 * the board — and the server cannot reach into `apps/cli`: apps do not import
 * apps, and `package:build` bundles the CLI and the server separately with every
 * `@corpus/*` import inlined. The alternative was a second version comparison
 * and a second asset-selection rule living in the server, and `verifiable`
 * exists precisely because those two can disagree: a release that looks
 * upgradable and is nonetheless refused. A server offering an action the upgrade
 * declines is the failure `UpgradeCheckSchema` tells clients not to produce.
 *
 * **This file stays as a re-export rather than being deleted**, so every import
 * inside `apps/cli` — including `release.test.ts`, which is the evidence the
 * move changed no behaviour — reads exactly what it read before. A test edited
 * during a move proves nothing about the move.
 */
export {
  compareVersions,
  DEFAULT_RELEASES_API,
  DEFAULT_RELEASES_REPO,
  evaluateRelease,
  lookupLatestRelease,
  RELEASES_API_ENV_VAR,
  RELEASES_REPO_ENV_VAR,
  releaseSource,
  selectAssets,
  userAgent,
} from "@corpus/contract";
export type {
  AssetSelection,
  LookupOptions,
  Release,
  ReleaseAsset,
  ReleaseAssets,
  ReleaseLookup,
  ReleaseVerdict,
} from "@corpus/contract";
