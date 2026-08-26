import type { Health, UpgradeCheck } from "@corpus/contract";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";

/**
 * SPEC.md §2.4's UI half (UI-035), in a browser.
 *
 * **What only a browser proves here**: that the version in the console strip is
 * a real control a person can click, that the panel it opens is a modal over the
 * board rather than something drawn into the strip, and that pressing "Upgrade &
 * restart" changes what the strip itself says — three separate components
 * agreeing, through a context, in a real layout.
 *
 * **What is deliberately left to the unit suite**: the drop-and-return cycle.
 * The e2e harness has no reachable event stream — the dev server is started with
 * no proxy target, so `/events` is refused (INFRA-028) — and the health probe is
 * only refetched when the SSE bridge invalidates it. Driving a restart here
 * would mean asserting against whatever the failing EventSource happened to do,
 * which is timing rather than behaviour. `UpgradePanel.test.tsx` drives it
 * through real query states instead.
 */

const CHECK: UpgradeCheck = {
  installed: "0.24.0",
  latest: "0.25.0",
  upgradeAvailable: true,
  verifiable: true,
  notesUrl: "https://example.invalid/releases/v0.25.0",
  reachable: true,
  detail: null,
};

const HEALTH: Health = {
  status: "ok",
  version: "0.24.0",
  uptimeSeconds: 12,
  workspace: "/tmp/stub-workspace",
};

test.describe("the updates panel", () => {
  test("opens from the version, reports the release, and rides the restart", async ({ page }) => {
    // The suite runs with no workspace server, so the strip would otherwise say
    // "server unreachable" and carry no version at all.
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(HEALTH),
      }),
    );
    let triggered = 0;
    await page.route("**/api/upgrade/check", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CHECK),
      }),
    );
    await page.route("**/api/upgrade", (route) => {
      triggered += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ started: true, logPath: ".corpus/upgrade.log" }),
      });
    });

    await page.goto("/");

    const version = page.locator(".c-status-button");
    await expect(version).toHaveText("corpus 0.24.0");
    // Nothing has been asked of GitHub yet: §2.4's opening promise, at the one
    // surface that could break it.
    await expect(page.locator(".upgrade-panel")).toHaveCount(0);

    await version.click();

    const panel = page.locator(".upgrade-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".upgrade-heading")).toHaveText("Update available");
    await expect(panel.locator(".upgrade-line")).toHaveText(
      "Corpus 0.25.0 is available. You are running 0.24.0.",
    );
    await expect(panel.getByRole("link", { name: "Read what changed" })).toHaveAttribute(
      "href",
      "https://example.invalid/releases/v0.25.0",
    );

    // A modal over the board, drawn on the shared overlay layer every panel in
    // the app uses — not something grown inside the strip.
    await expect(page.locator(".overlay.open")).toHaveCount(1);
    await expect(panel).toHaveAttribute("aria-modal", "true");

    await panel.getByRole("button", { name: "Upgrade & restart" }).click();

    await expect(panel.locator(".upgrade-riding")).toContainText("The server is being replaced");
    expect(triggered).toBe(1);
    // The offer is gone — there is nothing left to press — and Close is refused
    // while the one surface explaining the outage is the only one there is.
    await expect(panel.getByRole("button", { name: "Upgrade & restart" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Close" })).toBeDisabled();

    // And the strip behind it stops calling a deliberate absence a fault. This
    // is the defect UI-035 exists for, and it is three components apart from the
    // click that caused it.
    await expect(page.locator(".console-strip .c-status")).toHaveText("upgrading…");
    await expect(page.locator(".console-strip .c-failed")).toHaveCount(0);
  });

  test("explains a release it cannot verify instead of offering it", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(HEALTH),
      }),
    );
    await page.route("**/api/upgrade/check", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...CHECK,
          verifiable: false,
          detail: "it publishes no corpus-0.25.0.tgz.sha256",
        }),
      }),
    );

    await page.goto("/");
    await page.locator(".c-status-button").click();

    const panel = page.locator(".upgrade-panel");
    await expect(panel.locator(".upgrade-heading")).toHaveText("Update available, not installable");
    await expect(panel.locator(".upgrade-line")).toContainText("no corpus-0.25.0.tgz.sha256");
    // The rule the contract states: never offer an action the upgrade refuses.
    await expect(panel.getByRole("button", { name: "Upgrade & restart" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Close" })).toBeEnabled();
  });
});
