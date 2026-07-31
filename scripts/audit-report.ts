/**
 * The supply-chain gate behind `scripts/check-audit.ts` (INFRA-013).
 *
 * The directive is "zero vulnerabilities of **any** severity — no allowlist, no
 * severity floor". Two consequences shape this module, and both are the opposite
 * of the obvious implementation:
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
 * There is exactly one `kind: "clean"` return in this file and it is reachable
 * only from a numeric zero with no advisories behind it. Callers decide what to
 * do about `unreachable`; they cannot manufacture a `clean`.
 *
 * Pure: `scripts/check-audit.ts` is the thin runner that spawns `npm audit`.
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

export type AuditVerdict =
  | { readonly kind: "clean" }
  | {
      readonly kind: "findings";
      readonly total: number;
      readonly findings: readonly AuditFinding[];
    }
  /** The registry did not answer, or answered something this module cannot read as a verdict. */
  | { readonly kind: "unreachable"; readonly reason: string };

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

function findingsOf(report: z.infer<typeof AuditReportSchema>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    const advisories = (entry.via ?? []).filter((via) => typeof via !== "string");
    const parents = (entry.via ?? []).filter((via) => typeof via === "string");
    for (const advisory of advisories) {
      findings.push({
        package: name,
        severity: advisory.severity ?? entry.severity,
        title: advisory.title ?? "advisory reported without a title",
        url: advisory.url,
        range: advisory.range ?? entry.range,
      });
    }
    // A transitive-only entry carries no advisory of its own; it is still a
    // finding, and naming the parent is the only actionable thing about it.
    if (advisories.length === 0) {
      const cause = parents.length > 0 ? parents.join(", ") : "an undisclosed dependency";
      findings.push({
        package: name,
        severity: entry.severity,
        title: `vulnerable via ${cause}`,
        url: undefined,
        range: entry.range,
      });
    }
  }
  return findings;
}

/**
 * Reads `npm audit --json`'s stdout. The exit code is deliberately not an input:
 * it is 1 for both "found things" and "registry unreachable", so accepting it
 * here would invite a caller to branch on it.
 */
export function classifyAuditReport(stdout: string): AuditVerdict {
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
  const findings = findingsOf(report.data);
  if (total === 0 && findings.length === 0) return { kind: "clean" };
  return { kind: "findings", total, findings };
}

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

/** One line per advisory, so the developer never has to re-run the command the gate just ran. */
export function formatFinding(finding: AuditFinding): string {
  const where =
    finding.range === undefined ? finding.package : `${finding.package}@${finding.range}`;
  const link = finding.url === undefined ? "" : ` — ${finding.url}`;
  return `${finding.severity.padEnd(8)} ${where} — ${finding.title}${link}`;
}
