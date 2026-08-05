import { describe, expect, it } from "vitest";
import {
  UpgradeCheckSchema,
  UpgradeStartedSchema,
  type UpgradeCheck,
  type UpgradeStarted,
} from "./upgrade.js";

/**
 * SPEC.md §2.4's two shapes. What is worth testing here is not that a happy
 * answer round-trips — it is that every *unhappy* answer the §2.4 flow can
 * produce is representable, because each one this schema cannot express is one
 * the server would be forced to fake.
 */

/** A workspace one release behind, on a release that publishes its checksum. */
const behind = {
  installed: "0.3.0",
  latest: "0.4.0",
  upgradeAvailable: true,
  verifiable: true,
  notesUrl: "https://github.com/trupin/corpus/releases/tag/v0.4.0",
  reachable: true,
  detail: null,
};

const CHECK_KEYS = [
  "installed",
  "latest",
  "upgradeAvailable",
  "verifiable",
  "notesUrl",
  "reachable",
  "detail",
] as const;

describe("UpgradeCheck", () => {
  it("round-trips a check that found a newer, installable release", () => {
    expect(UpgradeCheckSchema.parse(behind)).toEqual(behind);
  });

  it("round-trips an up-to-date workspace, which has nothing to add", () => {
    const current = { ...behind, latest: "0.3.0", upgradeAvailable: false };
    expect(UpgradeCheckSchema.parse(current)).toEqual(current);
  });

  /**
   * §2.4's check "queries the GitHub Releases API", and a localhost tool is
   * offline, behind a captive portal or rate-limited often enough that this is
   * an ordinary answer rather than an exception. It arrives as a `200` body, so
   * the schema has to hold a check that looked at nothing while still reporting
   * the one fact that is always known — what is installed.
   */
  it("round-trips the unreachable check, with the installed version still known", () => {
    const offline = {
      installed: "0.3.0",
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      notesUrl: null,
      reachable: false,
      detail: "could not reach api.github.com (getaddrinfo ENOTFOUND)",
    };
    expect(UpgradeCheckSchema.parse(offline)).toEqual(offline);
  });

  /**
   * The reason `reachable` is a field rather than `latest === null`: a
   * distribution that has published nothing yet is a *successful* check with no
   * latest, and a client conflating the two would tell an offline operator that
   * Corpus has never shipped.
   */
  it("round-trips a reachable check against a distribution with no releases yet", () => {
    const nothingPublished = {
      ...behind,
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      notesUrl: null,
      detail: "the distribution has published no releases yet",
    };
    const parsed = UpgradeCheckSchema.parse(nothingPublished);
    expect(parsed.reachable).toBe(true);
    expect(parsed.latest).toBeNull();
  });

  /**
   * The case INFRA-016 created a boundary for: releases cut before the
   * `corpus-<version>.tgz.sha256` asset existed are real releases with real
   * version numbers that `corpus upgrade` will refuse, because §2.4 has it
   * verify the published checksum. `upgradeAvailable` and `verifiable` must
   * therefore be able to disagree — one boolean could not say this.
   */
  it("round-trips a newer release that publishes no checksum, so cannot be installed", () => {
    const unverifiable = {
      ...behind,
      verifiable: false,
      detail: "0.4.0 publishes no corpus-0.4.0.tgz.sha256 asset; install it by hand",
    };
    const parsed = UpgradeCheckSchema.parse(unverifiable);
    expect([parsed.upgradeAvailable, parsed.verifiable]).toEqual([true, false]);
  });

  /** Nullable, not optional — every key is on every answer, so absence means nothing. */
  it.each(CHECK_KEYS)("demands the key %s", (field) => {
    const { [field]: _dropped, ...missing } = behind;
    expect(UpgradeCheckSchema.safeParse(missing).success).toBe(false);
  });

  /** So the list above cannot quietly stop covering a field somebody adds. */
  it("names every key of the response in the required-key sweep", () => {
    expect(Object.keys(behind).sort()).toEqual([...CHECK_KEYS].sort());
  });

  /**
   * `null` is how this schema says "nothing"; `""` is a string that renders as a
   * blank link or an empty sentence. Allowing both would give the server two
   * spellings for one fact and a client two cases to handle.
   */
  it.each(["latest", "notesUrl", "detail"])("refuses an empty string for the nullable %s", (f) => {
    expect(UpgradeCheckSchema.safeParse({ ...behind, [f]: "" }).success).toBe(false);
  });

  it("refuses a blank installed version, which no running server has", () => {
    expect(UpgradeCheckSchema.safeParse({ ...behind, installed: "" }).success).toBe(false);
    const { installed: _dropped, ...missing } = behind;
    expect(UpgradeCheckSchema.safeParse(missing).success).toBe(false);
  });

  it.each(["upgradeAvailable", "verifiable", "reachable"])(
    "refuses a non-boolean %s rather than coercing it",
    (field) => {
      expect(UpgradeCheckSchema.safeParse({ ...behind, [field]: "yes" }).success).toBe(false);
    },
  );

  /**
   * A type-level probe, checked by `tsc --noEmit` rather than at runtime: the
   * annotation is what stops fizzling if a nullable field is ever narrowed to a
   * required string, which is exactly what would make the offline answer
   * unrepresentable.
   */
  it("keeps the offline answer representable in the inferred type", () => {
    const offline: UpgradeCheck = {
      installed: "0.3.0",
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      notesUrl: null,
      reachable: false,
      detail: "offline",
    };
    expect(offline.latest).toBeNull();
  });
});

describe("UpgradeStarted", () => {
  const started = { started: true, logPath: ".corpus/upgrade.log" };

  it("round-trips the acknowledgement of a spawned upgrade", () => {
    expect(UpgradeStartedSchema.parse(started)).toEqual(started);
  });

  /**
   * The inverse of `AppendLogResult.appended` and the seen mark's `unread`,
   * which are genuine booleans because a refusal is representable at their
   * status. Here the only refusal is the `409`, so `started: false` is a body no
   * handler can produce — and an unreachable branch is how clients grow dead
   * code that nothing ever exercises.
   */
  it("refuses a started:false body, because the refusal is the 409 and not this shape", () => {
    expect(UpgradeStartedSchema.safeParse({ ...started, started: false }).success).toBe(false);
  });

  it("makes that unrepresentable in the inferred type too, not only at parse time", () => {
    // @ts-expect-error `started` is `literal(true)`; this line failing to
    // compile *is* the assertion. It compiles again the moment someone relaxes
    // the literal to a boolean, which is the change this test exists to catch.
    const refused: UpgradeStarted = { started: false, logPath: ".corpus/upgrade.log" };
    expect(UpgradeStartedSchema.safeParse(refused).success).toBe(false);
  });

  /**
   * `logPath` is the whole reporting channel for §2.4's upgrade report — what
   * was updated, what was left alone, and the conflicts that are unresolved work
   * rather than notices. An empty or missing path leaves an agent with a
   * requirement it cannot act on.
   */
  it("demands a non-empty log path, since it is where the report lands", () => {
    expect(UpgradeStartedSchema.safeParse({ started: true, logPath: "" }).success).toBe(false);
    expect(UpgradeStartedSchema.safeParse({ started: true }).success).toBe(false);
  });
});
