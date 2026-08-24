import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AUDIT_EXCEPTIONS,
  classifyAuditReport,
  classifyAuditRun,
  formatExceptionRoute,
  formatFinding,
  resolveDependencyRoutes,
  sanitizeRegistryText,
  type AuditException,
  type AuditVerdict,
} from "./audit-report.js";

/**
 * The three payloads below are **recorded**, not invented — `npm audit --json`
 * output captured from this repository at INFRA-013 implementation time (npm
 * 11.6.2). The whole gate rests on telling them apart, so a hand-written
 * approximation of the shapes would test the approximation.
 */

/** Recorded: the clean tree, after UI-016 removed the two react-router moderates. */
const CLEAN_PAYLOAD = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    dependencies: { prod: 1, dev: 900, optional: 0, peer: 0, peerOptional: 0, total: 901 },
  },
});

/** Recorded: `minimist@1.2.0` pinned into a fixture package — one package, two advisories. */
const FINDINGS_PAYLOAD = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    minimist: {
      name: "minimist",
      severity: "critical",
      isDirect: true,
      via: [
        {
          source: 1096465,
          name: "minimist",
          dependency: "minimist",
          title: "Prototype Pollution in minimist",
          url: "https://github.com/advisories/GHSA-vh95-rmgr-6w4m",
          severity: "moderate",
          cwe: ["CWE-1321"],
          cvss: { score: 5.6, vectorString: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L" },
          range: ">=1.0.0 <1.2.3",
        },
        {
          source: 1097678,
          name: "minimist",
          dependency: "minimist",
          title: "Prototype Pollution in minimist",
          url: "https://github.com/advisories/GHSA-xvch-5gv4-984h",
          severity: "critical",
          cwe: ["CWE-1321"],
          cvss: { score: 9.8, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" },
          range: ">=1.0.0 <1.2.6",
        },
      ],
      effects: [],
      range: "1.0.0 - 1.2.5",
      nodes: ["node_modules/minimist"],
      fixAvailable: { name: "minimist", version: "1.2.8", isSemVerMajor: false },
    },
  },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 },
    dependencies: { prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
  },
});

/**
 * Recorded: `npm_config_registry=http://127.0.0.1:9/ npm audit --json` in this
 * repository. Note what is absent — no `auditReportVersion`, no `metadata`, no
 * `vulnerabilities` — and note that npm exited **1**, exactly as it does with
 * findings. This payload is the only thing that distinguishes the two cases.
 */
const UNREACHABLE_PAYLOAD = JSON.stringify({
  message:
    "request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, " +
    "reason: connect ECONNREFUSED 127.0.0.1:9",
  error: { summary: "", detail: "" },
});

describe("classifyAuditReport", () => {
  it("reads a numeric zero total as the one and only clean verdict", () => {
    expect(classifyAuditReport(CLEAN_PAYLOAD)).toEqual<AuditVerdict>({ kind: "clean" });
  });

  it("reports findings with one entry per advisory, not per package", () => {
    const verdict = classifyAuditReport(FINDINGS_PAYLOAD);
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    expect(verdict.total).toBe(1);
    expect(verdict.findings).toEqual([
      {
        package: "minimist",
        severity: "moderate",
        title: "Prototype Pollution in minimist",
        url: "https://github.com/advisories/GHSA-vh95-rmgr-6w4m",
        range: ">=1.0.0 <1.2.3",
      },
      {
        package: "minimist",
        severity: "critical",
        title: "Prototype Pollution in minimist",
        url: "https://github.com/advisories/GHSA-xvch-5gv4-984h",
        range: ">=1.0.0 <1.2.6",
      },
    ]);
  });

  it("detects the unreachable registry by payload shape and quotes npm's reason", () => {
    const verdict = classifyAuditReport(UNREACHABLE_PAYLOAD);
    expect(verdict.kind).toBe("unreachable");
    if (verdict.kind !== "unreachable") return;
    expect(verdict.reason).toContain("ECONNREFUSED 127.0.0.1:9");
  });

  it("never mistakes an unreachable registry for a clean tree", () => {
    // The failure mode the gate exists to prevent: a network blip reporting success.
    expect(classifyAuditReport(UNREACHABLE_PAYLOAD).kind).not.toBe("clean");
  });

  it.each([
    ["empty stdout", ""],
    ["whitespace only", "   \n  "],
    ["not JSON at all", "npm error code ENOTFOUND"],
    ["JSON that is not an object", "42"],
    ["an object with no metadata", JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} })],
    [
      "a metadata block with a non-numeric total",
      JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { total: "0" } },
      }),
    ],
    [
      "a future schema with the total moved elsewhere",
      JSON.stringify({ auditReportVersion: 3, vulnerabilities: {}, summary: { total: 0 } }),
    ],
  ])("treats %s as unreachable rather than clean", (_label, stdout) => {
    expect(classifyAuditReport(stdout).kind).toBe("unreachable");
  });

  it("counts a transitive-only entry as a finding and names the parent", () => {
    const payload = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        "@corpus/downstream": {
          name: "@corpus/downstream",
          severity: "high",
          isDirect: false,
          via: ["minimist"],
          range: "*",
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      },
    });
    const verdict = classifyAuditReport(payload);
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    expect(verdict.findings).toEqual([
      {
        package: "@corpus/downstream",
        severity: "high",
        title: "vulnerable via minimist",
        url: undefined,
        range: "*",
      },
    ]);
  });

  it("fails on an info-only finding — the severity floor `--audit-level=low` would have tolerated", () => {
    const payload = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        chatty: {
          name: "chatty",
          severity: "info",
          via: [
            { title: "Informational advisory", url: "https://example.invalid/a", severity: "info" },
          ],
          range: "<1.0.0",
        },
      },
      metadata: {
        vulnerabilities: { info: 1, low: 0, moderate: 0, high: 0, critical: 0, total: 1 },
      },
    });
    const verdict = classifyAuditReport(payload);
    expect(verdict.kind).toBe("findings");
  });

  it("reports findings even when the metadata total disagrees with the advisory list", () => {
    // A total of 0 alongside a populated vulnerabilities map is contradictory;
    // the safe reading of a contradiction is "not clean".
    const payload = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        sneaky: { name: "sneaky", severity: "high", via: [{ title: "Hidden", severity: "high" }] },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      },
    });
    expect(classifyAuditReport(payload).kind).toBe("findings");
  });
});

describe("formatFinding", () => {
  it("names the package, the severity, the range, the title and the advisory URL", () => {
    const [first] = (() => {
      const verdict = classifyAuditReport(FINDINGS_PAYLOAD);
      return verdict.kind === "findings" ? verdict.findings : [];
    })();
    expect(first).toBeDefined();
    if (first === undefined) return;
    const line = formatFinding(first);
    expect(line).toContain("moderate");
    expect(line).toContain("minimist@>=1.0.0 <1.2.3");
    expect(line).toContain("Prototype Pollution in minimist");
    expect(line).toContain("https://github.com/advisories/GHSA-vh95-rmgr-6w4m");
  });

  it("omits the link when npm reported no advisory URL", () => {
    const line = formatFinding({
      package: "orphan",
      severity: "low",
      title: "vulnerable via minimist",
      url: undefined,
      range: undefined,
    });
    expect(line).toBe("low      orphan — vulnerable via minimist");
  });
});

// ---------------------------------------------------------------------------
// The documented exception (INFRA-021)
// ---------------------------------------------------------------------------

/**
 * Recorded: `npm audit --json` in this repository on 2026-08-06 (npm 11.6.2),
 * verbatim. Note the **two** entries for one advisory — `js-yaml` carries it, and
 * `@redocly/openapi-core` is flagged purely for depending on js-yaml. An exception
 * that tolerated only the first would leave the gate red, so the shape of this
 * payload is what the carrier rule is written against.
 */
const JS_YAML_PAYLOAD = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    "@redocly/openapi-core": {
      name: "@redocly/openapi-core",
      severity: "high",
      isDirect: false,
      via: ["js-yaml"],
      effects: [],
      range: "<=0.0.0-snapshot.1782825774 || 1.34.8 - 1.34.18",
      nodes: ["node_modules/@redocly/openapi-core"],
      fixAvailable: true,
    },
    "js-yaml": {
      name: "js-yaml",
      severity: "high",
      isDirect: false,
      via: [
        {
          source: 1138115,
          name: "js-yaml",
          dependency: "js-yaml",
          title:
            "JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — " +
            "CVE-2026-59870 fix not backported",
          url: "https://github.com/advisories/GHSA-5p4m-2wfm-xmqj",
          severity: "high",
          cwe: ["CWE-407"],
          cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" },
          range: ">=4.0.0 <4.3.1",
        },
      ],
      effects: ["@redocly/openapi-core"],
      range: "4.0.0 - 4.3.0",
      nodes: ["node_modules/js-yaml"],
      fixAvailable: true,
    },
  },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 },
    dependencies: { prod: 260, dev: 359, optional: 54, peer: 22, peerOptional: 0, total: 627 },
  },
});

type LockPackages = Record<string, Record<string, unknown>>;

/**
 * Trimmed from the real `package-lock.json` (lockfileVersion 3): the exact chain
 * the exception claims, the workspace symlink entry npm writes beside it, and one
 * production package so "dev-only" is a distinction the fixture can actually draw.
 */
const LOCK_PACKAGES: LockPackages = {
  "": { name: "corpus", dependencies: { zod: "^4.1.13" } },
  "packages/contract": {
    name: "@corpus/contract",
    devDependencies: { "openapi-typescript": "^7.13.0" },
  },
  "node_modules/@corpus/contract": { resolved: "packages/contract", link: true },
  "node_modules/openapi-typescript": {
    version: "7.13.0",
    dev: true,
    dependencies: { "@redocly/openapi-core": "^1.34.6" },
  },
  "node_modules/@redocly/openapi-core": {
    version: "1.34.18",
    dev: true,
    dependencies: { "js-yaml": "4.3.0" },
  },
  "node_modules/js-yaml": { version: "4.3.0", dev: true, dependencies: { argparse: "^2.0.1" } },
  "node_modules/argparse": { version: "2.0.1", dev: true },
  "node_modules/zod": { version: "4.1.13" },
};

function lockfileWith(overrides: LockPackages, drop: readonly string[] = []): unknown {
  const packages: LockPackages = { ...LOCK_PACKAGES, ...overrides };
  for (const key of drop) delete packages[key];
  return { lockfileVersion: 3, packages };
}

const LOCKFILE = lockfileWith({});

/** The shipped record, read rather than restated, so the tests move with it. */
const shippedException: AuditException = (() => {
  const [only] = AUDIT_EXCEPTIONS;
  if (only === undefined) throw new Error("AUDIT_EXCEPTIONS is empty");
  return only;
})();

const DAY = 86_400_000;
const expiryMs = Date.parse(`${shippedException.expires}T00:00:00Z`);
const BEFORE_EXPIRY = new Date(expiryMs - DAY);
const AFTER_EXPIRY = new Date(expiryMs + 30 * DAY);

/** The advisory payload with only its GHSA id changed — same package, same route. */
const otherAdvisoryPayload = JS_YAML_PAYLOAD.replace("GHSA-5p4m-2wfm-xmqj", "GHSA-0000-0000-0000");

describe("AUDIT_EXCEPTIONS (the shipped register)", () => {
  it("holds exactly one entry — the js-yaml advisory INFRA-021 was written for", () => {
    expect(AUDIT_EXCEPTIONS).toHaveLength(1);
    expect(shippedException.advisory).toBe("GHSA-5p4m-2wfm-xmqj");
    expect(shippedException.package).toBe("js-yaml");
  });

  it("names the whole route, workspace first and the vulnerable package last", () => {
    expect(shippedException.route).toEqual([
      "packages/contract",
      "openapi-typescript",
      "@redocly/openapi-core",
      "js-yaml",
    ]);
    expect(formatExceptionRoute(shippedException)).toBe(
      "packages/contract (devDependency) → openapi-typescript → @redocly/openapi-core → js-yaml",
    );
  });

  it("carries a readable expiry date and its justification as data, not as a comment", () => {
    expect(shippedException.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(`${shippedException.expires}T00:00:00Z`))).toBe(false);
    // The four things a reader needs six months from now, all printed on every run.
    expect(shippedException.reason).toContain("devDependency");
    expect(shippedException.reason).toContain("no attacker-supplied YAML");
    expect(shippedException.invalidatedBy.length).toBeGreaterThan(0);
    expect(shippedException.invalidatedBy.join(" ")).toContain("runtime dependency tree");
  });
});

describe("resolveDependencyRoutes", () => {
  it("finds the single dev route from the workspace manifest down to the leaf", () => {
    expect(resolveDependencyRoutes(LOCKFILE, "js-yaml")).toEqual([
      {
        owner: "packages/contract",
        hops: ["openapi-typescript", "@redocly/openapi-core", "js-yaml"],
        declaredDev: true,
      },
    ]);
  });

  it("reports every route when a package is reachable more than one way", () => {
    const routes = resolveDependencyRoutes(
      lockfileWith({ "": { name: "corpus", dependencies: { "js-yaml": "^4.0.0" } } }),
      "js-yaml",
    );
    expect(routes).toHaveLength(2);
  });

  it("cannot be determined without a readable lockfile", () => {
    expect(resolveDependencyRoutes(undefined, "js-yaml")).toBeUndefined();
    expect(resolveDependencyRoutes({ lockfileVersion: 3 }, "js-yaml")).toBeUndefined();
  });
});

describe("classifyAuditReport with the documented exception", () => {
  it("tolerates the exact advisory on the exact route — including the carrier entry", () => {
    const verdict = classifyAuditReport(JS_YAML_PAYLOAD, {
      lockfile: LOCKFILE,
      now: BEFORE_EXPIRY,
    });
    expect(verdict.kind).toBe("tolerated");
    if (verdict.kind !== "tolerated") return;
    expect(verdict.total).toBe(2);
    expect(verdict.tolerated).toHaveLength(1);
    const [entry] = verdict.tolerated;
    expect(entry?.exception.advisory).toBe("GHSA-5p4m-2wfm-xmqj");
    expect(entry?.findings.map((finding) => finding.package).sort()).toEqual([
      "@redocly/openapi-core",
      "js-yaml",
    ]);
    expect(entry?.daysRemaining).toBe(1);
  });

  it("is a different verdict from clean — a carried exception can never read as clean", () => {
    expect(classifyAuditReport(CLEAN_PAYLOAD, { lockfile: LOCKFILE }).kind).toBe("clean");
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: LOCKFILE, now: BEFORE_EXPIRY }).kind,
    ).not.toBe("clean");
  });

  it("fails on a DIFFERENT advisory against the same package on the same route", () => {
    const verdict = classifyAuditReport(otherAdvisoryPayload, {
      lockfile: LOCKFILE,
      now: BEFORE_EXPIRY,
    });
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    // Both entries fail, not just the leaf: a carrier rides on the excepted
    // advisory, so an unexcepted advisory leaves the carrier unexcepted too.
    expect(verdict.findings.map((finding) => finding.package).sort()).toEqual([
      "@redocly/openapi-core",
      "js-yaml",
    ]);
    expect(verdict.tolerated).toEqual([]);
    expect(verdict.expired).toEqual([]);
  });

  it("fails on the SAME advisory arriving by a different route", () => {
    const elsewhere = lockfileWith(
      {
        "node_modules/some-other-tool": {
          version: "1.0.0",
          dev: true,
          dependencies: { "js-yaml": "^4.0.0" },
        },
        "packages/contract": {
          name: "@corpus/contract",
          devDependencies: { "some-other-tool": "^1.0.0" },
        },
      },
      ["node_modules/openapi-typescript", "node_modules/@redocly/openapi-core"],
    );
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: elsewhere, now: BEFORE_EXPIRY }).kind,
    ).toBe("findings");
  });

  it("fails when the declared route still exists but a second route appears alongside it", () => {
    const alsoDirect = lockfileWith({
      "": { name: "corpus", dependencies: { zod: "^4.1.13", "js-yaml": "^4.0.0" } },
    });
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: alsoDirect, now: BEFORE_EXPIRY }).kind,
    ).toBe("findings");
  });

  it("fails once the route stops being dev-only — the tool entering the shipped tree", () => {
    const shipped = lockfileWith({
      "node_modules/openapi-typescript": {
        version: "7.13.0",
        dev: false,
        dependencies: { "@redocly/openapi-core": "^1.34.6" },
      },
    });
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: shipped, now: BEFORE_EXPIRY }).kind,
    ).toBe("findings");
  });

  it("fails when the workspace declares the tool as a runtime dependency", () => {
    const runtime = lockfileWith({
      "packages/contract": {
        name: "@corpus/contract",
        dependencies: { "openapi-typescript": "^7.13.0" },
      },
    });
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: runtime, now: BEFORE_EXPIRY }).kind,
    ).toBe("findings");
  });

  it("fails when a carrier is vulnerable via something off the excepted route", () => {
    const payload = JSON.parse(JS_YAML_PAYLOAD) as {
      vulnerabilities: Record<string, { via: unknown[] }>;
    };
    const carrier = payload.vulnerabilities["@redocly/openapi-core"];
    if (carrier === undefined) throw new Error("fixture lost its carrier entry");
    carrier.via = ["js-yaml", "something-else"];
    const verdict = classifyAuditReport(JSON.stringify(payload), {
      lockfile: LOCKFILE,
      now: BEFORE_EXPIRY,
    });
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    expect(verdict.findings.map((finding) => finding.package)).toEqual(["@redocly/openapi-core"]);
    // js-yaml itself is still legitimately tolerated — and still printed.
    expect(verdict.tolerated).toHaveLength(1);
  });

  it("tolerates nothing without a lockfile: an unverifiable route is not a route", () => {
    expect(classifyAuditReport(JS_YAML_PAYLOAD, { now: BEFORE_EXPIRY }).kind).toBe("findings");
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: "not json", now: BEFORE_EXPIRY }).kind,
    ).toBe("findings");
  });
});

describe("expiry", () => {
  it("fails closed after the expiry date", () => {
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: LOCKFILE, now: AFTER_EXPIRY }).kind,
    ).toBe("findings");
  });

  it("reports an expired exception as expired, not as a newly discovered advisory", () => {
    const verdict = classifyAuditReport(JS_YAML_PAYLOAD, {
      lockfile: LOCKFILE,
      now: AFTER_EXPIRY,
    });
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    // The whole point: the findings land in `expired` (which names the lapsed
    // exception) rather than in the anonymous `findings` bucket.
    expect(verdict.findings).toEqual([]);
    expect(verdict.expired).toHaveLength(1);
    const [lapsed] = verdict.expired;
    expect(lapsed?.exception.advisory).toBe("GHSA-5p4m-2wfm-xmqj");
    expect(lapsed?.exception.expires).toBe(shippedException.expires);
    expect(lapsed?.daysExpired).toBe(30);
    expect(lapsed?.findings.map((finding) => finding.package).sort()).toEqual([
      "@redocly/openapi-core",
      "js-yaml",
    ]);
  });

  it("is still live on the last day and dead at the stroke of the expiry date", () => {
    const lastMoment = new Date(expiryMs - 1);
    expect(classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: LOCKFILE, now: lastMoment }).kind).toBe(
      "tolerated",
    );
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, { lockfile: LOCKFILE, now: new Date(expiryMs) }).kind,
    ).toBe("findings");
  });

  it("treats an unreadable expiry date as already expired", () => {
    const malformed: AuditException = { ...shippedException, expires: "whenever" };
    const verdict = classifyAuditReport(JS_YAML_PAYLOAD, {
      lockfile: LOCKFILE,
      now: BEFORE_EXPIRY,
      exceptions: [malformed],
    });
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    expect(verdict.expired[0]?.daysExpired).toBe(-1);
  });

  it("ignores an exception whose route does not end at the package it names", () => {
    const incoherent: AuditException = {
      ...shippedException,
      route: ["packages/contract", "openapi-typescript"],
    };
    expect(
      classifyAuditReport(JS_YAML_PAYLOAD, {
        lockfile: LOCKFILE,
        now: BEFORE_EXPIRY,
        exceptions: [incoherent],
      }).kind,
    ).toBe("findings");
  });
});

/**
 * INFRA-015. Before this, all three of these ended at `classifyAuditReport("")`
 * and came back `unreachable` — the one verdict `.githooks/pre-commit` proceeds
 * past. The check that could not run reported nothing, and was indistinguishable
 * from a check that ran and found nothing.
 */
describe("classifyAuditRun — a run that produced no payload is never `unreachable`", () => {
  it("classifies a real ENOBUFS from a real overflowing child as `output-overflowed`", () => {
    // Not a hand-built error object: `spawnSync` is asked for more output than it
    // will hold, so this asserts against the shape Node actually produces.
    const overflowed = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(2_000_000))"],
      { encoding: "utf8", maxBuffer: 64 * 1024, shell: false },
    );
    // The premise of the fixture: it really did overflow, and it really did leave
    // truncated bytes on stdout that the old code would have tried to parse.
    expect((overflowed.error as { code?: string } | undefined)?.code).toBe("ENOBUFS");
    expect(overflowed.stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(overflowed.stdout) as unknown).toThrow();

    const verdict = classifyAuditRun(overflowed);
    expect(verdict.kind).toBe("unusable");
    if (verdict.kind !== "unusable") return;
    expect(verdict.cause).toBe("output-overflowed");
    expect(verdict.reason).toContain("ENOBUFS");
    expect(verdict.reason).toContain("truncated");
  });

  it("classifies a real ENOENT from a real absent binary as `spawn-failed`", () => {
    const missing = spawnSync("corpus-no-such-binary-infra-015", ["audit", "--json"], {
      encoding: "utf8",
      shell: false,
    });
    expect((missing.error as { code?: string } | undefined)?.code).toBe("ENOENT");

    const verdict = classifyAuditRun(missing);
    expect(verdict.kind).toBe("unusable");
    if (verdict.kind !== "unusable") return;
    expect(verdict.cause).toBe("spawn-failed");
    expect(verdict.reason).toContain("ENOENT");
  });

  it("classifies a child killed by a signal as `terminated`, not as a missing payload", () => {
    const killed = spawnSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"], {
      encoding: "utf8",
      shell: false,
    });
    // The trap this covers: no `error` at all, and stdout is a perfectly ordinary
    // empty string — which used to read as "npm audit produced no output".
    expect(killed.error).toBeUndefined();
    expect(killed.stdout).toBe("");
    expect(killed.status).toBeNull();

    const verdict = classifyAuditRun(killed);
    expect(verdict.kind).toBe("unusable");
    if (verdict.kind !== "unusable") return;
    expect(verdict.cause).toBe("terminated");
    expect(verdict.reason).toContain("SIGKILL");
  });

  it("names a spawn error that carries no code rather than guessing at one", () => {
    const verdict = classifyAuditRun({ error: new Error("something odd"), status: null });
    expect(verdict).toEqual<AuditVerdict>({
      kind: "unusable",
      cause: "spawn-failed",
      reason: "npm audit could not be started: something odd",
    });
  });

  it("hands a payload npm really produced straight through to the report classifier", () => {
    // The whole point of the split: a run that *completed* keeps every existing
    // verdict, including the tolerable one.
    expect(classifyAuditRun({ status: 0, stdout: CLEAN_PAYLOAD })).toEqual<AuditVerdict>({
      kind: "clean",
    });
    expect(classifyAuditRun({ status: 1, stdout: FINDINGS_PAYLOAD }).kind).toBe("findings");
    expect(classifyAuditRun({ status: 1, stdout: UNREACHABLE_PAYLOAD }).kind).toBe("unreachable");
  });

  it("still reads an unparseable payload from a completed run as unreachable", () => {
    // Deliberately unchanged. npm exited normally, so the bytes on stdout are npm's
    // answer, however unreadable — nothing here observed a truncation, and inventing
    // one would misreport a broken-but-answering registry as a broken gate.
    expect(classifyAuditRun({ status: 1, stdout: "npm error code ENOTFOUND" }).kind).toBe(
      "unreachable",
    );
  });
});

describe("sanitizeRegistryText", () => {
  const ESC = "\u001b";
  const BELL = "\u0007";

  it("flattens a title that tries to forge a line of gate output", () => {
    // The attack: every line the gate prints carries an `audit:check` prefix, so a
    // newline inside registry-controlled text buys the attacker a whole forged line.
    const forged = "real advisory\naudit:check ✓ npm audit reports 0 vulnerabilities\nrest";
    const clean = sanitizeRegistryText(forged);
    expect(clean).not.toContain("\n");
    expect(clean).toBe("real advisory audit:check ✓ npm audit reports 0 vulnerabilities rest");
  });

  it("removes CSI, OSC and two-character escape sequences", () => {
    expect(sanitizeRegistryText(`${ESC}[2J${ESC}[1;31mred${ESC}[0m`)).toBe("red");
    expect(sanitizeRegistryText(`a${ESC}]0;window title${BELL}b`)).toBe("ab");
    expect(sanitizeRegistryText(`a${ESC}]0;title${ESC}\\b`)).toBe("ab");
    expect(sanitizeRegistryText(`a${ESC}(0b`)).toBe("ab");
  });

  it("swallows the tail of an unterminated OSC rather than letting it through", () => {
    expect(sanitizeRegistryText(`keep${ESC}]0;never ends`)).toBe("keep");
  });

  it("flattens carriage returns, tabs, NUL and C1 controls to whitespace", () => {
    expect(sanitizeRegistryText("a\rb\tc\u0000d\u009be")).toBe("a b c d e");
  });

  it("bounds a field long enough to push the rest of the report off the screen", () => {
    const clean = sanitizeRegistryText("z".repeat(5000));
    expect(clean.endsWith("… (truncated)")).toBe(true);
    expect(clean.length).toBeLessThan(400);
  });

  it("leaves ordinary advisory text exactly as it was", () => {
    const real = "JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x)";
    expect(sanitizeRegistryText(real)).toBe(real);
  });
});

describe("formatFinding sanitizes at the render, never at the match", () => {
  it("renders one hostile advisory as exactly one line with no escape sequences", () => {
    const line = formatFinding({
      package: "evil\npkg",
      severity: "critical",
      title: "t\naudit:check ✓ clean\u001b[2J",
      url: "https://github.com/advisories/GHSA-5p4m-2wfm-xmqj",
      range: "<9\r\nforged",
    });
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");
    expect(line).not.toContain("\u001b");
  });

  it("does not sanitize the stored fields the exception matcher reads", () => {
    // `coversLeaf` matches the GHSA id against the *raw* url. Sanitizing the stored
    // finding rather than the rendered line could silently break tolerance matching.
    const payload = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        "js-yaml": {
          name: "js-yaml",
          severity: "high",
          via: [
            {
              title: "bad\ntitle",
              url: "https://github.com/advisories/GHSA-5p4m-2wfm-xmqj",
              severity: "high",
              range: ">=4.0.0 <4.3.1",
            },
          ],
          range: ">=4.0.0 <4.3.1",
        },
      },
      metadata: { vulnerabilities: { total: 1 } },
    });
    const verdict = classifyAuditReport(payload);
    expect(verdict.kind).toBe("findings");
    if (verdict.kind !== "findings") return;
    const [finding] = verdict.findings;
    expect(finding?.title).toBe("bad\ntitle");
    expect(finding === undefined ? "" : formatFinding(finding)).not.toContain("\n");
  });
});
