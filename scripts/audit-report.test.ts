import { describe, expect, it } from "vitest";
import { classifyAuditReport, formatFinding, type AuditVerdict } from "./audit-report.js";

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
