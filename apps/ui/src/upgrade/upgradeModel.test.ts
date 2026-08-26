import type { UpgradeCheck } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  canUpgrade,
  checkHeading,
  checkSentence,
  doneSentence,
  unchangedSentence,
  UPGRADING_SENTENCE,
} from "./upgradeModel";

function check(overrides: Partial<UpgradeCheck> = {}): UpgradeCheck {
  return {
    installed: "0.24.0",
    latest: "0.25.0",
    upgradeAvailable: true,
    verifiable: true,
    notesUrl: "https://example.invalid/notes",
    reachable: true,
    detail: null,
    ...overrides,
  };
}

describe("canUpgrade", () => {
  it("needs both verdicts, not either", () => {
    expect(canUpgrade(check())).toBe(true);
    expect(canUpgrade(check({ verifiable: false }))).toBe(false);
    expect(canUpgrade(check({ upgradeAvailable: false }))).toBe(false);
  });

  /*
   * The rule the contract states and this exists to keep: a newer release that
   * publishes no checksum is one the upgrade refuses. Offering the action for it
   * hands a person a refusal instead of an upgrade.
   */
  it("refuses to offer an action the upgrade would decline", () => {
    expect(canUpgrade(check({ upgradeAvailable: true, verifiable: false }))).toBe(false);
  });
});

describe("checkSentence", () => {
  it("names both versions when there is something to install", () => {
    expect(checkSentence(check())).toBe("Corpus 0.25.0 is available. You are running 0.24.0.");
  });

  it("says nothing is to be done when the versions match", () => {
    const answer = check({ latest: "0.24.0", upgradeAvailable: false });
    expect(checkSentence(answer)).toBe("Corpus 0.24.0 is the newest release. Nothing to install.");
  });

  it("explains an unverifiable release rather than offering it", () => {
    const answer = check({ verifiable: false, detail: "no sha256 asset" });
    expect(checkSentence(answer)).toContain("cannot be installed automatically");
    expect(checkSentence(answer)).toContain("no sha256 asset");
  });

  it("renders the server's sentence when the look failed", () => {
    const answer = check({
      reachable: false,
      latest: null,
      detail: "the API could not be reached",
    });
    expect(checkSentence(answer)).toBe("the API could not be reached");
  });

  it("still says something when the server sent no detail", () => {
    const answer = check({ reachable: false, latest: null, detail: null });
    expect(checkSentence(answer)).toContain("could not be read");
  });

  it("distinguishes a distribution with no releases from an unreachable one", () => {
    const none = check({ latest: null, upgradeAvailable: false, verifiable: false, detail: null });
    expect(checkSentence(none)).toContain("no releases yet");
    expect(checkHeading(none)).toBe("Up to date");
  });
});

describe("checkHeading", () => {
  it("never claims more than the sentence beside it", () => {
    expect(checkHeading(check())).toBe("Update available");
    expect(checkHeading(check({ verifiable: false }))).toBe("Update available, not installable");
    expect(checkHeading(check({ upgradeAvailable: false }))).toBe("Up to date");
    expect(checkHeading(check({ reachable: false }))).toBe("Could not look");
  });
});

describe("the restart's sentences", () => {
  it("does not read as a fault while the server is deliberately away", () => {
    expect(UPGRADING_SENTENCE).toContain("reconnects on its own");
    expect(UPGRADING_SENTENCE).not.toContain("unreachable server");
    expect(UPGRADING_SENTENCE).not.toContain("failed");
  });

  it("reports the move when the version changed", () => {
    expect(doneSentence("0.24.0", "0.25.0")).toContain("Upgraded from 0.24.0 to 0.25.0");
  });

  /*
   * The one that must not claim success. An upgrade can decline after starting
   * — an undetectable install method, a release that stopped being verifiable —
   * and the server coming back on the same version is not evidence either way.
   */
  it("claims neither success nor failure when the version did not move", () => {
    const said = unchangedSentence("0.24.0", ".corpus/upgrade.log");
    expect(said).toContain("the version it was already running");
    expect(said).toContain(".corpus/upgrade.log");
    expect(said).not.toContain("Upgraded");
  });
});
