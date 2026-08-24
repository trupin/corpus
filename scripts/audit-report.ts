/**
 * The supply-chain gate behind `scripts/check-audit.ts` (INFRA-013, **amended by
 * INFRA-021**).
 *
 * The original directive was "zero vulnerabilities of **any** severity — no
 * allowlist, no severity floor". Two consequences shaped this module, and both
 * are the opposite of the obvious implementation:
 *
 * 1. **The verdict is `metadata.vulnerabilities.total === 0`, not `--audit-level`.**
 *    `npm audit --audit-level=low` exits 0 on `info` findings — `info` sits below
 *    `low` in the six-bucket metadata — so a severity floor is a silent allowlist
 *    for the lowest bucket. The total has no floor at all. `--audit-level` is not
 *    passed anywhere, deliberately: an unused flag is one fewer knob that can be
 *    turned into a loophole later.
 *
 * 2. **The exit code cannot be trusted to say what happened.** Measured (npm
 *    11.6.2): `npm audit` with findings exits 1, and `npm audit` against an
 *    unreachable registry *also* exits 1. The only discriminator is the shape of
 *    the `--json` payload on stdout:
 *
 *      reachable   → { auditReportVersion, vulnerabilities, metadata }, with a
 *                    numeric `metadata.vulnerabilities.total`
 *      unreachable → { message, error: { summary, detail } } — no total at all
 *
 *    So the rule this module implements is: a **numeric total is the verdict**;
 *    anything else (an error envelope, unparseable output, empty stdout, a future
 *    npm that changes the schema) means the registry did not answer. A gate that
 *    inferred "clean" from a missing total would report success on every network
 *    blip, which is the one failure mode worth losing sleep over.
 *
 * ---------------------------------------------------------------------------
 * ## The amendment: documented exceptions (INFRA-021, user decision 2026-08-06)
 * ---------------------------------------------------------------------------
 *
 * This file used to say "no allowlist". It now has one entry — and the argument
 * for changing the policy belongs here, next to the rule, not in a commit
 * message nobody will find.
 *
 * **What forced it.** `GHSA-5p4m-2wfm-xmqj` (js-yaml ≤ 4.3.0, high) reaches this
 * repository through `packages/contract`'s devDependency on `openapi-typescript`,
 * and it is not fixable from here: `openapi-typescript@7.13.0` is the latest
 * published version, `@redocly/openapi-core` pins `js-yaml: "4.3.0"` **exactly**,
 * and scoped overrides, global overrides, forced lock re-resolution and a
 * from-scratch lockfile regeneration each left js-yaml at 4.3.0 with zero churn
 * and no npm warning. (Overrides do work in this repo — `brace-expansion@5.0.9`
 * and `minimatch@10.2.6` are live proof — so this is a pin we cannot reach, not a
 * tool we failed to use.) The three options were: hold everything until Redocly
 * and then `openapi-typescript` cut releases; replace the generator that produces
 * the client both the UI and the CLI consume; or carry the finding openly for a
 * bounded time. The user chose the third.
 *
 * **Why an "allowlist" was still the wrong shape.** A per-package or per-severity
 * ignore would also swallow the *next* advisory on the same package, which is the
 * failure the original directive was written against, and it would decay
 * silently. So an exception here is not an ignore rule. It is a dated,
 * self-invalidating claim about one advisory arriving by one route, and it is
 * enforced against the lockfile on every run:
 *
 *   - **Narrow.** It matches on the GHSA id *and* the package *and* the exact
 *     dependency route, verified against `package-lock.json`. A different advisory
 *     on js-yaml fails. The same advisory reached another way fails. A route hop
 *     that stops being `dev: true` — i.e. the tool entering the shipped runtime
 *     tree, which is the whole basis of the justification — fails.
 *   - **Expiring.** `expires` is a hard date. Past it the finding is *not*
 *     tolerated, and it is reported as an **expired exception**, never as a fresh
 *     advisory, so nobody re-diagnoses a known problem.
 *   - **Loud.** A tolerated finding produces `kind: "tolerated"`, which is a
 *     different verdict from `kind: "clean"`. The gate can pass, but it can never
 *     *read* as clean while it is carrying something.
 *   - **Justified in place.** `reason` and `invalidatedBy` are fields on the
 *     record, printed on every run — the justification cannot drift away from the
 *     rule, because it *is* the rule's data.
 *
 * **What is still forbidden, permanently:** a severity floor, an environment
 * variable, `CI` detection, a package-name allowlist, and any exception without
 * an expiry. There is no input to this module that turns a finding into `clean`.
 * Every uncertainty — unreadable lockfile, ambiguous route, malformed date —
 * resolves to "not tolerated".
 *
 * Pure: `scripts/check-audit.ts` is the thin runner that spawns `npm audit` and
 * hands the lockfile in.
 */

import { z } from "zod";

/** One advisory, named individually so a failure never says "2 vulnerabilities, run npm audit". */
export interface AuditFinding {
  /** The vulnerable package as npm's `vulnerabilities` map keys it. */
  readonly package: string;
  /** `info` | `low` | `moderate` | `high` | `critical`, per-advisory where npm gives it. */
  readonly severity: string;
  /** The advisory title, or a derived description for a purely transitive entry. */
  readonly title: string;
  /** The GitHub advisory URL when npm reports one. */
  readonly url: string | undefined;
  /** The affected version range npm reports. */
  readonly range: string | undefined;
}

/**
 * A dated, route-scoped tolerance for exactly one advisory.
 *
 * Every field is load-bearing at run time — none of it is documentation that a
 * reader has to trust. `advisory` + `package` are matched against npm's report;
 * `route` is matched against `package-lock.json`; `expires` is matched against
 * the clock; `reason` and `invalidatedBy` are printed on every run.
 */
export interface AuditException {
  /** GHSA id. Matched as a substring of the advisory URL npm reports. */
  readonly advisory: string;
  /** The vulnerable package this advisory is filed against. */
  readonly package: string;
  /**
   * The one and only way `package` may reach this repository: the owning
   * workspace directory first (`""` for the root manifest), then every hop, then
   * `package` itself. The lockfile must agree **exactly** — no extra routes, no
   * different route — and every hop must be a dev-only install.
   */
  readonly route: readonly string[];
  /**
   * ISO `YYYY-MM-DD`. The exception is void from `00:00:00Z` on this day. An
   * unparseable date is void immediately.
   */
  readonly expires: string;
  /** Why tolerating this is defensible. Printed verbatim on every run. */
  readonly reason: string;
  /** The conditions under which the reasoning above stops holding. Also printed. */
  readonly invalidatedBy: readonly string[];
}

/** An exception that applied, with the findings it covered. */
export interface ToleratedException {
  readonly exception: AuditException;
  readonly findings: readonly AuditFinding[];
  /** Whole days until `expires`; `0` on the last valid day. */
  readonly daysRemaining: number;
}

/** An exception that matched the advisory and the route, but has run out of time. */
export interface ExpiredException {
  readonly exception: AuditException;
  readonly findings: readonly AuditFinding[];
  /** Whole days since `expires`. `-1` when the date could not be parsed at all. */
  readonly daysExpired: number;
}

export type AuditVerdict =
  | { readonly kind: "clean" }
  /**
   * Nothing is failing, but the tree is **not clean**: every finding is covered
   * by a live documented exception. Deliberately a distinct kind from `clean` so
   * no caller can print a clean success line while carrying one.
   */
  | {
      readonly kind: "tolerated";
      readonly total: number;
      readonly tolerated: readonly ToleratedException[];
    }
  | {
      readonly kind: "findings";
      readonly total: number;
      /** Findings no exception covers at all. */
      readonly findings: readonly AuditFinding[];
      /** Findings whose exception lapsed — reported as lapsed, not as new. */
      readonly expired: readonly ExpiredException[];
      /** Still printed even though something else is failing: the gate is never silent. */
      readonly tolerated: readonly ToleratedException[];
    }
  /** The registry did not answer, or answered something this module cannot read as a verdict. */
  | { readonly kind: "unreachable"; readonly reason: string }
  /**
   * **The check itself did not run** — `npm` never started, was killed, or wrote
   * more than the capture buffer could hold. Deliberately a distinct kind from
   * `unreachable`, because the two have opposite tolerances (INFRA-015):
   * `unreachable` is a fact about the network, which a local commit may proceed
   * past, while this is a fact about the gate, which nothing may proceed past.
   * Nobody may derive a network story from it.
   */
  | { readonly kind: "unusable"; readonly cause: AuditRunFailure; readonly reason: string };

/** Why {@link classifyAuditRun} could not get a payload to classify. */
export type AuditRunFailure =
  /** `npm` could not be started at all — absent from `PATH`, not executable, out of processes. */
  | "spawn-failed"
  /** `npm` wrote more than `maxBuffer` and the capture was truncated (`ENOBUFS`). */
  | "output-overflowed"
  /** `npm` started but never exited normally — killed by a signal, no exit code. */
  | "terminated";

/**
 * The live exception register. **One entry.** Adding a second one is a policy
 * decision, not a maintenance task: read the amendment argument at the top of
 * this file first, and note that "the date passed" is never on its own a reason
 * to move a date — an expired exception must be re-argued from scratch or
 * removed.
 */
export const AUDIT_EXCEPTIONS: readonly AuditException[] = Object.freeze([
  Object.freeze({
    advisory: "GHSA-5p4m-2wfm-xmqj",
    package: "js-yaml",
    // packages/contract --(devDependency)--> openapi-typescript --> @redocly/openapi-core --> js-yaml
    route: Object.freeze([
      "packages/contract",
      "openapi-typescript",
      "@redocly/openapi-core",
      "js-yaml",
    ]),
    /*
     * Eight weeks (2026-08-06 → 2026-10-01). Long enough for the fix to travel
     * the only path it can — Redocly moving an exact pin, then a new
     * `openapi-typescript` release picking it up — and short enough that this
     * lands inside the next release cycle instead of becoming furniture. It is
     * deliberately not "end of quarter" or "a year": the point of the date is to
     * force a conversation while the reasoning is still fresh.
     */
    expires: "2026-10-01",
    reason:
      "Build-time only, and not shipped. `openapi-typescript` is a devDependency of " +
      "packages/contract, run once by the client-generation step; `package:build` leaves " +
      "third-party dependencies external and derives the published package's runtime " +
      "dependencies from the esbuild metafile, so this js-yaml is in no artifact a user " +
      "installs. The advisory is a quadratic-CPU denial of service on `!!omap` parsing, " +
      "and the only YAML the tool parses is the OpenAPI document this repository generates " +
      "from its own zod-openapi route definitions — no attacker-supplied YAML goes near it. " +
      "Unfixable from here: openapi-typescript@7.13.0 is the latest published release and " +
      "@redocly/openapi-core pins js-yaml to exactly 4.3.0, which no npm override reaches.",
    invalidatedBy: Object.freeze([
      "openapi-typescript (or @redocly/openapi-core) enters the runtime dependency tree — " +
        "checked automatically: every hop of the route must be `dev: true` in package-lock.json",
      "js-yaml becomes reachable by any other route — checked automatically against the lockfile",
      "a different advisory is filed against js-yaml — this exception names one GHSA id only",
      "the generated client stops being produced by openapi-typescript, in which case delete " +
        "this entry rather than re-point it",
    ]),
  }),
]);

/**
 * One entry of the `via` array. npm mixes two things in it: an advisory object
 * for a direct finding, and a bare package **name** when the entry is vulnerable
 * only because something it depends on is.
 */
const ViaSchema = z.union([
  z.string(),
  z.looseObject({
    title: z.string().optional(),
    url: z.string().optional(),
    severity: z.string().optional(),
    range: z.string().optional(),
  }),
]);

const VulnerabilitySchema = z.looseObject({
  name: z.string(),
  severity: z.string(),
  range: z.string().optional(),
  via: z.array(ViaSchema).optional(),
});

/**
 * The reachable payload. Every field named here is load-bearing: the presence of
 * a numeric `metadata.vulnerabilities.total` **is** the "registry answered"
 * signal, so this schema failing to parse is not a bug, it is the other branch.
 */
const AuditReportSchema = z.looseObject({
  auditReportVersion: z.number(),
  vulnerabilities: z.record(z.string(), VulnerabilitySchema),
  metadata: z.looseObject({
    vulnerabilities: z.looseObject({ total: z.number() }),
  }),
});

/**
 * A finding plus the evidence an exception has to match against. Kept internal:
 * `AuditFinding` is what callers render, this is what the matcher reasons over.
 */
interface Candidate {
  readonly finding: AuditFinding;
  /** The advisory URL, when this candidate came from a real advisory object. */
  readonly url: string | undefined;
  /** The bare package names in `via` — the vulnerable parents of a carrier entry. */
  readonly parents: readonly string[];
}

function candidatesOf(report: z.infer<typeof AuditReportSchema>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    const advisories = (entry.via ?? []).filter((via) => typeof via !== "string");
    const parents = (entry.via ?? []).filter((via) => typeof via === "string");
    for (const advisory of advisories) {
      candidates.push({
        finding: {
          package: name,
          severity: advisory.severity ?? entry.severity,
          title: advisory.title ?? "advisory reported without a title",
          url: advisory.url,
          range: advisory.range ?? entry.range,
        },
        url: advisory.url,
        parents,
      });
    }
    // A transitive-only entry carries no advisory of its own; it is still a
    // finding, and naming the parent is the only actionable thing about it.
    if (advisories.length === 0) {
      const cause = parents.length > 0 ? parents.join(", ") : "an undisclosed dependency";
      candidates.push({
        finding: {
          package: name,
          severity: entry.severity,
          title: `vulnerable via ${cause}`,
          url: undefined,
          range: entry.range,
        },
        url: undefined,
        parents,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Route verification against package-lock.json
// ---------------------------------------------------------------------------

const LockEntrySchema = z.looseObject({
  dev: z.boolean().optional(),
  link: z.boolean().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

const LockfileSchema = z.looseObject({
  packages: z.record(z.string(), LockEntrySchema),
});

/** One way a package reaches this repository, as the lockfile declares it. */
interface DependencyRoute {
  /** `""` for the root manifest, otherwise a workspace directory (`packages/contract`). */
  readonly owner: string;
  /** Package names: the owner's direct dependency first, the resolved package last. */
  readonly hops: readonly string[];
  /** The owner declares the first hop under `devDependencies`. */
  readonly declaredDev: boolean;
}

/**
 * Guards against a pathological graph turning route resolution into a hang. Both
 * are far above anything a real route needs; exceeding either means "this module
 * cannot say what the route is", which resolves to *not tolerated*.
 */
const MAX_ROUTE_DEPTH = 24;
const MAX_ROUTES = 32;

/** `node_modules/a/node_modules/b` → `b`; `packages/contract` → `packages/contract`; `""` → `""`. */
function entryName(key: string): string {
  const marker = "node_modules/";
  const at = key.lastIndexOf(marker);
  return at === -1 ? key : key.slice(at + marker.length);
}

/** A lockfile key with no `node_modules/` segment is a manifest: the root or a workspace. */
function isManifestKey(key: string): boolean {
  return !key.includes("node_modules/");
}

interface Declarer {
  readonly key: string;
  readonly name: string;
  readonly isManifest: boolean;
  readonly viaDevDependencies: boolean;
}

/**
 * Reverse edges of the lockfile: package name → everything that *declares* a
 * dependency on it. Declaration-based rather than resolution-based, so two
 * physical copies of a package yield two routes — an over-approximation, in the
 * fail-closed direction.
 *
 * `devDependencies` are followed only from manifests (npm does not install a
 * transitive package's devDependencies); `peerDependencies` only from packages.
 */
function buildDeclarerIndex(packages: Record<string, z.infer<typeof LockEntrySchema>>) {
  const index = new Map<string, Declarer[]>();
  const add = (dependency: string, declarer: Declarer): void => {
    const existing = index.get(dependency);
    if (existing === undefined) index.set(dependency, [declarer]);
    else existing.push(declarer);
  };

  for (const [key, entry] of Object.entries(packages)) {
    if (entry.link === true) continue; // a workspace symlink declares nothing of its own
    const isManifest = isManifestKey(key);
    const name = entryName(key);
    const fields: readonly (readonly [Record<string, string> | undefined, boolean])[] = isManifest
      ? [
          [entry.dependencies, false],
          [entry.devDependencies, true],
          [entry.optionalDependencies, false],
        ]
      : [
          [entry.dependencies, false],
          [entry.optionalDependencies, false],
          [entry.peerDependencies, false],
        ];
    for (const [block, viaDevDependencies] of fields) {
      for (const dependency of Object.keys(block ?? {})) {
        add(dependency, { key, name, isManifest, viaDevDependencies });
      }
    }
  }
  return index;
}

/** Every hop must be a dev-only install, in every physical copy the lockfile has. */
function everyHopIsDevOnly(
  packages: Record<string, z.infer<typeof LockEntrySchema>>,
  hops: readonly string[],
): boolean {
  return hops.every((hop) => {
    const copies = Object.entries(packages).filter(
      ([key, entry]) => !isManifestKey(key) && entryName(key) === hop && entry.link !== true,
    );
    return copies.length > 0 && copies.every(([, entry]) => entry.dev === true);
  });
}

/**
 * Every route by which `packageName` reaches a manifest in this repository.
 * `undefined` means "could not be determined" (no readable lockfile, or the
 * graph blew a guard) — which callers must treat as *not tolerated*.
 */
export function resolveDependencyRoutes(
  lockfile: unknown,
  packageName: string,
): readonly DependencyRoute[] | undefined {
  const parsed = LockfileSchema.safeParse(lockfile);
  if (!parsed.success) return undefined;
  const { packages } = parsed.data;
  const index = buildDeclarerIndex(packages);

  const routes: DependencyRoute[] = [];
  let blewAGuard = false;

  const walk = (name: string, suffix: readonly string[], seen: readonly string[]): void => {
    if (blewAGuard) return;
    if (suffix.length > MAX_ROUTE_DEPTH || routes.length > MAX_ROUTES) {
      blewAGuard = true;
      return;
    }
    for (const declarer of index.get(name) ?? []) {
      if (declarer.isManifest) {
        routes.push({
          owner: declarer.key,
          hops: [name, ...suffix],
          declaredDev: declarer.viaDevDependencies,
        });
        continue;
      }
      if (seen.includes(declarer.name)) continue; // cycle
      walk(declarer.name, [name, ...suffix], [...seen, name]);
    }
  };

  walk(packageName, [], []);
  return blewAGuard ? undefined : routes;
}

/**
 * The lockfile half of "narrow": the excepted package must reach this repository
 * by the declared route and by nothing else, and that route must be dev-only.
 */
function routeHolds(exception: AuditException, lockfile: unknown): boolean {
  const declared = exception.route;
  if (declared.length < 2) return false;
  if (declared[declared.length - 1] !== exception.package) return false;

  const routes = resolveDependencyRoutes(lockfile, exception.package);
  if (routes === undefined || routes.length !== 1) return false;

  const [route] = routes;
  if (route === undefined || !route.declaredDev) return false;
  const actual = [route.owner, ...route.hops];
  if (actual.length !== declared.length) return false;
  if (!actual.every((segment, at) => segment === declared[at])) return false;

  const parsed = LockfileSchema.safeParse(lockfile);
  if (!parsed.success) return false;
  return everyHopIsDevOnly(parsed.data.packages, route.hops);
}

/**
 * The advisory half of "narrow", for the vulnerable package itself: the GHSA id
 * must be the one named, and the package must be vulnerable for that reason
 * alone — a second, unexcepted parent means this is no longer the situation that
 * was justified.
 */
function coversLeaf(exception: AuditException, candidate: Candidate): boolean {
  return (
    candidate.finding.package === exception.package &&
    candidate.url !== undefined &&
    candidate.url.includes(exception.advisory) &&
    candidate.parents.length === 0
  );
}

/**
 * A **carrier** is an interior hop npm flags with no advisory of its own, purely
 * for depending on the vulnerable leaf (`via: ["js-yaml"]`). It is covered only
 * when it is vulnerable exclusively via packages on the excepted route — *and*
 * only when the leaf itself was covered in this same report, which the caller
 * establishes. Without that second condition a **new** advisory on js-yaml would
 * fail the gate on js-yaml while its carriers stayed tolerated: half a verdict,
 * and the exception would be doing work it was never justified for.
 */
function coversCarrier(exception: AuditException, candidate: Candidate): boolean {
  const interior = exception.route.slice(1, -1);
  return (
    interior.includes(candidate.finding.package) &&
    candidate.url === undefined &&
    candidate.parents.length > 0 &&
    candidate.parents.every((parent) => exception.route.includes(parent))
  );
}

const MILLISECONDS_PER_DAY = 86_400_000;

/** `undefined` for a date this module cannot read — which makes the exception void. */
function expiryInstant(exception: AuditException): number | undefined {
  const parsed = Date.parse(`${exception.expires}T00:00:00Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Inputs the gate must be given rather than reach for, so every branch is testable. */
export interface AuditContext {
  /** Defaults to now. The clock is an input because expiry is a rule, not a side effect. */
  readonly now?: Date;
  /** Parsed `package-lock.json`. Omit (or pass `undefined`) and nothing is tolerated. */
  readonly lockfile?: unknown;
  /** Defaults to {@link AUDIT_EXCEPTIONS}. */
  readonly exceptions?: readonly AuditException[];
}

/**
 * Reads `npm audit --json`'s stdout. The exit code is deliberately not an input:
 * it is 1 for both "found things" and "registry unreachable", so accepting it
 * here would invite a caller to branch on it.
 */
export function classifyAuditReport(stdout: string, context: AuditContext = {}): AuditVerdict {
  const trimmed = stdout.trim();
  if (trimmed === "") return { kind: "unreachable", reason: "npm audit produced no output" };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch {
    return { kind: "unreachable", reason: "npm audit did not produce JSON on stdout" };
  }

  const report = AuditReportSchema.safeParse(parsedJson);
  if (!report.success) {
    return { kind: "unreachable", reason: reasonFromErrorEnvelope(parsedJson) };
  }

  const total = report.data.metadata.vulnerabilities.total;
  const candidates = candidatesOf(report.data);
  if (total === 0 && candidates.length === 0) return { kind: "clean" };

  const now = context.now ?? new Date();
  const exceptions = context.exceptions ?? AUDIT_EXCEPTIONS;
  // A route can only be verified against a lockfile. No lockfile, no tolerance.
  // An exception is applicable only if its route holds *and* the report actually
  // contains the advisory it names — carriers ride on the leaf, never alone.
  const applicable = exceptions.filter(
    (exception) =>
      routeHolds(exception, context.lockfile) &&
      candidates.some((candidate) => coversLeaf(exception, candidate)),
  );

  const uncovered: AuditFinding[] = [];
  const toleratedBy = new Map<AuditException, AuditFinding[]>();
  const expiredBy = new Map<AuditException, AuditFinding[]>();

  for (const candidate of candidates) {
    const exception = applicable.find(
      (entry) => coversLeaf(entry, candidate) || coversCarrier(entry, candidate),
    );
    if (exception === undefined) {
      uncovered.push(candidate.finding);
      continue;
    }
    const instant = expiryInstant(exception);
    const live = instant !== undefined && now.getTime() < instant;
    const bucket = live ? toleratedBy : expiredBy;
    const existing = bucket.get(exception);
    if (existing === undefined) bucket.set(exception, [candidate.finding]);
    else existing.push(candidate.finding);
  }

  const tolerated: ToleratedException[] = [...toleratedBy].map(([exception, findings]) => ({
    exception,
    findings,
    daysRemaining: Math.max(
      0,
      Math.floor(((expiryInstant(exception) ?? 0) - now.getTime()) / MILLISECONDS_PER_DAY),
    ),
  }));

  const expired: ExpiredException[] = [...expiredBy].map(([exception, findings]) => {
    const instant = expiryInstant(exception);
    return {
      exception,
      findings,
      daysExpired:
        instant === undefined
          ? -1
          : Math.max(0, Math.floor((now.getTime() - instant) / MILLISECONDS_PER_DAY)),
    };
  });

  if (uncovered.length > 0 || expired.length > 0) {
    return { kind: "findings", total, findings: uncovered, expired, tolerated };
  }
  return { kind: "tolerated", total, tolerated };
}

/**
 * The half of `spawnSync`'s result that says whether there is a payload to read
 * at all. Structural rather than `SpawnSyncReturns<string>` so a test can build
 * one, and so this module never depends on `node:child_process`.
 */
export interface AuditRun {
  /** `spawnSync`'s `error`: set when the child never started, or blew `maxBuffer`. */
  readonly error?: unknown;
  /** The child's exit code. `null` means it never exited normally. */
  readonly status: number | null;
  /** The signal that killed the child, when one did. */
  readonly signal?: string | null;
  /** Captured stdout. `undefined` when the child never ran. */
  readonly stdout?: string | null;
}

/** `spawnSync` reports overflow as an `Error` carrying this `code`. Measured on Node 22 and 25. */
const OVERFLOW_CODE = "ENOBUFS";

/** `unknown` because `spawnSync`'s `error` is typed as a bare `Error`; the `code` is not in the type. */
function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The verdict for a whole `npm audit` **run**, not just its stdout (INFRA-015).
 *
 * This exists because the three ways a run can produce no payload all used to
 * arrive at `classifyAuditReport("")` and come back `unreachable` — the one
 * verdict `.githooks/pre-commit` is allowed to proceed past. So the check most
 * likely to break on a badly broken tree was also the one that broke *quietly*,
 * and it blamed the registry for it. Concretely: a tree with more advisories
 * than the capture buffer could hold got its stdout truncated, `JSON.parse`
 * threw, and the commit went through with "the npm registry did not answer".
 *
 * Every branch here is fail-closed at the caller, with **no tolerate flag**:
 * "the gate did not run" is never a reason to report that it found nothing.
 * Only a payload that npm actually produced can reach `classifyAuditReport`,
 * and only that can be `unreachable`.
 */
export function classifyAuditRun(run: AuditRun, context: AuditContext = {}): AuditVerdict {
  const unusable = (cause: AuditRunFailure, reason: string): AuditVerdict => ({
    kind: "unusable",
    cause,
    reason: sanitizeRegistryText(reason),
  });

  if (run.error !== undefined && run.error !== null) {
    const code = errorCodeOf(run.error);
    const message = errorMessageOf(run.error);
    if (code === OVERFLOW_CODE) {
      return unusable(
        "output-overflowed",
        `npm audit wrote more output than the capture buffer holds (${OVERFLOW_CODE}); ` +
          "the payload was truncated and no verdict can be read from it",
      );
    }
    return unusable(
      "spawn-failed",
      `npm audit could not be started${code === undefined ? "" : ` (${code})`}: ${message}`,
    );
  }

  if (run.status === null) {
    const bySignal = typeof run.signal === "string" && run.signal !== "" ? ` by ${run.signal}` : "";
    return unusable(
      "terminated",
      `npm audit was killed${bySignal} and never exited, so it produced no verdict`,
    );
  }

  return classifyAuditReport(run.stdout ?? "", context);
}

/**
 * Registry-controlled text — advisory titles, ranges, URLs, npm's own error
 * message — reaches a terminal through this module. Everything it renders is
 * prefixed line-by-line by the caller, so an advisory title carrying a newline
 * could forge a whole line of gate output ("audit:check ✓ …"), and an ANSI
 * sequence could repaint or erase the lines around it. This is a spoofing
 * defence for the human reader only: nothing downstream parses the report, and
 * matching (advisory id, route) is always done against the **raw** field, never
 * against this.
 *
 * Removes ANSI escape sequences, flattens every remaining control character to
 * a space, collapses runs of whitespace, and bounds the length so one enormous
 * field cannot push the rest of the report off the screen.
 */
export function sanitizeRegistryText(text: string): string {
  const ESCAPE = 0x1b;
  const BELL = 0x07;
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    if (code === ESCAPE) {
      at = skipEscapeSequence(text, at);
      continue;
    }
    // C0, DEL and C1 — newline and carriage return among them, on purpose.
    out.push(code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : (text[at] ?? ""));
    at += 1;
  }
  const flattened = out.join("").replace(/\s+/g, " ").trim();
  return flattened.length <= MAX_RENDERED_LENGTH
    ? flattened
    : `${flattened.slice(0, MAX_RENDERED_LENGTH)}… (truncated)`;

  /** Returns the index just past the escape sequence starting at {@link from}. */
  function skipEscapeSequence(source: string, from: number): number {
    const next = source.charCodeAt(from + 1);
    // CSI: ESC [ , parameter and intermediate bytes, then one final byte 0x40-0x7E.
    if (next === 0x5b) {
      let scan = from + 2;
      while (scan < source.length) {
        const byte = source.charCodeAt(scan);
        scan += 1;
        if (byte >= 0x40 && byte <= 0x7e) return scan;
      }
      return scan;
    }
    // OSC: ESC ] , a payload, then BEL or ST (ESC followed by a backslash).
    // An unterminated sequence swallows the rest of the string, which is the point.
    if (next === 0x5d) {
      let scan = from + 2;
      while (scan < source.length) {
        const byte = source.charCodeAt(scan);
        if (byte === BELL) return scan + 1;
        if (byte === ESCAPE && source.charCodeAt(scan + 1) === 0x5c) return scan + 2;
        scan += 1;
      }
      return scan;
    }
    /*
     * Everything else follows the general escape grammar: ESC, then zero or more
     * intermediate bytes (0x20-0x2F), then one final byte (0x30-0x7E). Assuming a
     * flat two characters is wrong for the ones that carry an intermediate — the
     * charset designators, `ESC ( 0` among them — and getting it wrong leaks the
     * final byte back into the rendered line as ordinary text.
     */
    let scan = from + 1;
    while (scan < source.length) {
      const byte = source.charCodeAt(scan);
      scan += 1;
      if (byte >= 0x20 && byte <= 0x2f) continue; // intermediate
      if (byte >= 0x30 && byte <= 0x7e) return scan; // final
      // Anything else (a control byte, another ESC) never belonged to this
      // sequence: stop before it and let the main loop deal with it.
      return scan - 1;
    }
    return scan;
  }
}

/** Generous for a real advisory title, far short of a screenful of forged output. */
const MAX_RENDERED_LENGTH = 300;

/**
 * npm's unreachable payload is `{ message, error: { summary, detail } }`. Any
 * other unreadable shape gets a generic reason rather than a guess.
 */
const ErrorEnvelopeSchema = z.looseObject({ message: z.string() });

function reasonFromErrorEnvelope(parsedJson: unknown): string {
  const envelope = ErrorEnvelopeSchema.safeParse(parsedJson);
  if (envelope.success) return envelope.data.message;
  return "npm audit returned no vulnerability totals — the registry did not answer";
}

/**
 * One line per advisory, so the developer never has to re-run the command the
 * gate just ran. **One** line: every field here comes from the registry, and the
 * caller prefixes each line it prints, so a title carrying a newline would
 * otherwise forge a line of gate output. {@link sanitizeRegistryText} is applied
 * here, at the render, and nowhere near the matching.
 */
export function formatFinding(finding: AuditFinding): string {
  const clean = (field: string): string => sanitizeRegistryText(field);
  const where =
    finding.range === undefined
      ? clean(finding.package)
      : `${clean(finding.package)}@${clean(finding.range)}`;
  const link = finding.url === undefined ? "" : ` — ${clean(finding.url)}`;
  return `${clean(finding.severity).padEnd(8)} ${where} — ${clean(finding.title)}${link}`;
}

/** `packages/contract (devDependency) → openapi-typescript → … → js-yaml`. */
export function formatExceptionRoute(exception: AuditException): string {
  const [owner, ...hops] = exception.route;
  const from = owner === undefined || owner === "" ? "<root>" : owner;
  return [`${from} (devDependency)`, ...hops].join(" → ");
}
