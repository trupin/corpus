import { MIN_USABLE_HEIGHT_PX, MIN_USABLE_HEIGHT_TOKEN } from "@corpus/kit";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import {
  OVERLAYS,
  type BatteryCheck,
  type ExitAffordance,
  type OverlayEntry,
  type ScrollRegionDecl,
} from "./overlayRegistry";

/**
 * The overlay battery (UI-193): every overlay the product can open, opened
 * over the **crowded fixture** (`crowdedLanes()` — ten lanes, long names, long
 * labels) at the default window size, and judged on the defect classes the
 * broken designation popover shipped with (the 2026-09-06 report):
 *
 * - **fits** — nothing interactive is clipped below an edge or covered
 *   (the UI-195 finding's class: a control a person cannot press);
 * - **exit** — a working exit affordance, of the kind the entry declares;
 * - **escape** — Escape dismisses, and focus returns to the opener where one
 *   survives the gesture;
 * - **scroll** — every scroll region that actually overflows is at least
 *   `--min-usable-height` tall, and shows the affordance it declares.
 *
 * The minimum is read from `@corpus/kit` — the token, never a literal
 * (sprint-026 seam 1: two hard-coded 120s in two specs is not a shared
 * minimum).
 *
 * **What this battery cannot catch, honestly** (sprint-026 seam 2): meaning.
 * Two controls that edit the same thing — as the pre-UI-192 "at" pill and the
 * popover's WEIGHT rows did — pass every check here. That class is the
 * evaluator's, as one checklist item in `.claude/agents/evaluator.md`, and
 * claiming it here would be the check lying about its coverage.
 *
 * A registered failure is pinned, not skipped: `expectedFailures` runs the
 * check under `test.fail()`, so the battery stays the reproduction of the
 * defect until the named issue lands — at which point the check passes
 * "unexpectedly", the run goes red, and the annotation must be removed.
 */

const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(E2E_DIR, "..", "..", "..");

/* ── The completeness scan: a new overlay registers or fails here ───────── */

/** `.tsx` files under `root`, tests excluded, as repo-relative paths. */
function tsxFiles(root: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"))
        out.push(relative(REPO_ROOT, path));
    }
  };
  walk(root);
  return out;
}

/** The exact named imports of `names` from kit or from kit's Controls dir. */
function importsPrimitive(content: string, names: readonly string[]): boolean {
  const imports = content.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"(@corpus\/kit|[^"]*components\/Controls[^"]*)"/g,
  );
  for (const found of imports) {
    const specifiers = (found[1] ?? "").split(",").map(
      (raw) =>
        raw
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0] ?? "",
    );
    if (specifiers.some((name) => names.includes(name))) return true;
  }
  return false;
}

test.describe("the overlay registry is complete", () => {
  test("every overlay definition site is claimed by a registry entry", () => {
    const claimed = new Set(OVERLAYS.flatMap((entry) => entry.sources));
    const files = [
      ...tsxFiles(resolve(REPO_ROOT, "apps", "ui", "src")),
      ...tsxFiles(resolve(REPO_ROOT, "packages", "kit", "src")),
    ];
    const unregistered: string[] = [];
    for (const file of files) {
      // The primitives are the mechanism, not surfaces of their own; every
      // *use* of them is caught by the import scan below.
      if (file.includes("components/Controls/")) continue;
      const content = readFileSync(resolve(REPO_ROOT, file), "utf8");
      const definesOverlay =
        content.includes('role="dialog"') || importsPrimitive(content, ["Modal", "Popover"]);
      if (definesOverlay && !claimed.has(file)) unregistered.push(file);
    }
    expect(
      unregistered,
      `These files define an overlay (role="dialog", or kit Modal/Popover) but no ` +
        `overlayRegistry.ts entry claims them — register each so the battery judges it:\n` +
        unregistered.map((file) => `  - ${file}`).join("\n"),
    ).toEqual([]);
  });

  test("every registry entry still points at real sources", () => {
    const gone = OVERLAYS.flatMap((entry) =>
      entry.sources
        .filter((source) => !existsSync(resolve(REPO_ROOT, source)))
        .map((source) => `${entry.id} → ${source}`),
    );
    expect(
      gone,
      `These registry entries name sources that no longer exist — a deleted ` +
        `overlay leaves the registry rather than rotting in it:\n` +
        gone.map((line) => `  - ${line}`).join("\n"),
    ).toEqual([]);
  });
});

/* ── The battery ────────────────────────────────────────────────────────── */

/** Marks the test expected-to-fail when the entry pins this check to an issue. */
function pinExpected(entry: OverlayEntry, check: BatteryCheck): void {
  const expected = entry.expectedFailures?.find((failure) => failure.check === check);
  if (expected !== undefined) test.fail(true, `${expected.issue} owes the fix: ${expected.reason}`);
}

/**
 * One state of an entry with everything the four checks read resolved: the
 * entry's own `open` is its base state (its `tag` is the bare id, so the
 * battery's historical test names hold), and each of `furtherStates` is a
 * separate run with its overrides applied. This is the phase-60 repair: the
 * designation popover was green here in its designating state while its
 * "no owner" state — a different host, a different clip, and the surface's
 * only weight editor — had never been opened by any check.
 */
interface ResolvedState {
  readonly tag: string;
  readonly surface: string;
  readonly exit: ExitAffordance;
  readonly opener: string | null;
  readonly scrollRegions: readonly ScrollRegionDecl[];
  readonly open: (page: Page) => Promise<void>;
}

function statesOf(entry: OverlayEntry): readonly ResolvedState[] {
  return [
    {
      tag: entry.id,
      surface: entry.surface,
      exit: entry.exit,
      opener: entry.opener,
      scrollRegions: entry.scrollRegions,
      open: entry.open,
    },
    ...entry.furtherStates.map((state) => ({
      tag: `${entry.id} [${state.id}]`,
      surface: state.surface ?? entry.surface,
      exit: state.exit ?? entry.exit,
      opener: state.opener === undefined ? entry.opener : state.opener,
      scrollRegions: state.scrollRegions ?? entry.scrollRegions,
      open: state.open,
    })),
  ];
}

for (const entry of OVERLAYS) {
  for (const state of statesOf(entry)) {
    test.describe(`overlay: ${state.tag}`, () => {
      test(`${state.tag}: nothing interactive is clipped or covered`, async ({ page }) => {
        pinExpected(entry, "fits");
        await state.open(page);
        const problems = await page.evaluate(
          ({ surfaceSel, scrollSels }) => {
            const surface = document.querySelector(surfaceSel);
            if (surface === null) return [`the surface is gone: ${surfaceSel}`];
            const out: string[] = [];
            const interactive = surface.querySelectorAll<HTMLElement>(
              'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
            );
            for (const el of interactive) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              // Elements inside a declared scroll region are reachable by
              // that region's scroll; the scroll check judges the region
              // itself. The exemption holds only while the region can
              // actually scroll: a declared region whose overflow is visible
              // gives no cover, or a surface that regressed to clipping (the
              // phase-60 FAIL-1 layout) would keep an exemption written for
              // the scrolling repair.
              const exempt = scrollSels.some((sel) => {
                if (el.matches(sel)) return false;
                const region = el.closest(sel);
                return region !== null && /(auto|scroll)/.test(getComputedStyle(region).overflowY);
              });
              if (exempt) continue;
              const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
                .trim()
                .slice(0, 48);
              const firstClass =
                typeof el.className === "string" ? (el.className.split(" ")[0] ?? "") : "";
              const who = `<${el.tagName.toLowerCase()}${firstClass === "" ? "" : ` .${firstClass}`}> “${name}”`;
              if (
                rect.top < 0 ||
                rect.left < 0 ||
                rect.bottom > window.innerHeight ||
                rect.right > window.innerWidth
              ) {
                out.push(
                  `${who} leaves the ${String(window.innerWidth)}×${String(window.innerHeight)} ` +
                    `viewport (top ${String(Math.round(rect.top))}, bottom ${String(Math.round(rect.bottom))})`,
                );
                continue;
              }
              const inset = Math.min(4, rect.width / 4, rect.height / 4);
              const points: readonly (readonly [number, number])[] = [
                [rect.left + rect.width / 2, rect.top + rect.height / 2],
                [rect.left + inset, rect.top + inset],
                [rect.right - inset, rect.top + inset],
                [rect.left + inset, rect.bottom - inset],
                [rect.right - inset, rect.bottom - inset],
              ];
              const reachable = points.some(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return hit !== null && (el === hit || el.contains(hit) || hit.contains(el));
              });
              if (!reachable)
                out.push(`${who} is not hit-testable at any sampled point — clipped or covered`);
            }
            return out;
          },
          {
            surfaceSel: state.surface,
            scrollSels: state.scrollRegions.map((region) => region.selector),
          },
        );
        expect(problems, problems.join("\n")).toEqual([]);
      });

      test(`${state.tag}: the declared exit affordance works`, async ({ page }) => {
        pinExpected(entry, "exit");
        await state.open(page);
        const surface = page.locator(state.surface);
        if (state.exit.kind === "scrim") {
          // The mockup draws these panels with no close control; the scrim is
          // the exit, and it must actually be one.
          await expect(page.locator(state.exit.selector).first()).toBeVisible();
          await page.mouse.click(8, 8);
        } else {
          const control = page.locator(state.exit.selector).first();
          await expect(control, `no visible exit control at ${state.exit.selector}`).toBeVisible();
          await control.click();
        }
        await expect(surface).toBeHidden();
      });

      test(`${state.tag}: Escape dismisses${state.opener === null ? "" : ", focus returns"}`, async ({
        page,
      }) => {
        pinExpected(entry, "escape");
        await state.open(page);
        const surface = page.locator(state.surface);
        await expect(surface).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(surface).toBeHidden();
        if (state.opener !== null) await expect(page.locator(state.opener).first()).toBeFocused();
      });

      test(`${state.tag}: scroll regions are usable and say so`, async ({ page }) => {
        pinExpected(entry, "scroll");
        await state.open(page);
        // Every region that actually overflows — declared or not — must be at
        // least the minimum usable height. The affordance half is asserted only
        // where declared: a raw region has no generic overflow marker, and
        // inventing one here would be the check lying about its coverage.
        const regions = await page.evaluate((surfaceSel) => {
          const surface = document.querySelector(surfaceSel);
          if (surface === null) return null;
          return [surface, ...surface.querySelectorAll("*")]
            .filter((el): el is HTMLElement => el instanceof HTMLElement)
            .filter((el) => {
              const style = getComputedStyle(el);
              return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
            })
            .map((el) => ({
              who: `<${el.tagName.toLowerCase()}${
                typeof el.className === "string" && el.className !== ""
                  ? ` .${el.className.split(" ")[0] ?? ""}`
                  : ""
              }>`,
              height: el.clientHeight,
            }));
        }, state.surface);
        expect(regions, `the surface is gone: ${state.surface}`).not.toBeNull();
        for (const region of regions ?? []) {
          expect(
            region.height,
            `${region.who} overflows at ${String(region.height)}px — below ` +
              `${MIN_USABLE_HEIGHT_TOKEN} (${String(MIN_USABLE_HEIGHT_PX)}px)`,
          ).toBeGreaterThanOrEqual(MIN_USABLE_HEIGHT_PX);
        }
        for (const declared of state.scrollRegions) {
          if (declared.affordance === undefined) continue;
          const overflowing = await page
            .locator(declared.selector)
            .first()
            .evaluate((el) => el.scrollHeight > el.clientHeight + 1)
            .catch(() => false);
          if (!overflowing) continue;
          await expect(
            page.locator(declared.affordance).first(),
            `${declared.selector} overflows but its declared affordance ` +
              `${declared.affordance} is not visible`,
          ).toBeVisible();
        }
      });
    });
  }
}

/* ── The probe the phase-60 evaluation ran by hand (FAIL-1) ─────────────── */

/**
 * In the "no owner" state the popover's WEIGHT rows are the surface's only
 * weight editor (UI-192's decision record), and the compose panel is the
 * tightest clip any ComposerAddress host provides — so the crowded card is
 * capped at the panel and scrolls as one piece. That declaration exempts the
 * card's content from the generic fits hit-test above, which is why this
 * probe exists: it asserts, in the evaluator's own terms, that the rows are
 * really operable — a wheel over the card moves it, `elementFromPoint` at
 * each row's centre answers the row, and a real mouse click chooses a level.
 * The evaluation recorded the exact opposite of all three: the rows laid out
 * past the clip, hit-tested to the scrim, and a real click dismissed the
 * popover instead of choosing.
 */
const DESIGNATION = OVERLAYS.find((candidate) => candidate.id === "designation-popover");
const NO_OWNER = DESIGNATION?.furtherStates.find((candidate) => candidate.id === "no-owner");

test.describe("overlay: designation-popover [no-owner] — the weight editor is operable", () => {
  test("the weight rows hit-test as themselves and a real click chooses a level", async ({
    page,
  }) => {
    if (NO_OWNER === undefined) throw new Error("the no-owner state left the registry");
    await NO_OWNER.open(page);
    const card = page.locator('[data-address-pop="compose"]');
    const rows = page.locator('[data-address-pop="compose"] .weight-opt');
    await expect(rows).toHaveCount(3);

    // Where the card overflows its clip it must scroll under a real wheel —
    // "a wheel over the same point moves nothing" was the evaluation's step 7.
    // Aimed at the card's bottom sliver — below the roster's own scroll
    // region, over the statement line, so the gesture reaches the card and
    // never latches onto the list — and polled after the turn: Playwright's
    // wheel does not wait for scrolling.
    const overflowing = await card.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    if (overflowing) {
      const box = await card.boundingBox();
      if (box === null) throw new Error("the card has no box to aim the wheel at");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
      await page.mouse.wheel(0, 200);
      await expect
        .poll(() => card.evaluate((el) => el.scrollTop), {
          message: "a real wheel over the card moved nothing",
        })
        .toBeGreaterThan(0);
      for (let turn = 0; turn < 10; turn += 1) {
        const end = await card.evaluate(
          (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
        );
        if (end) break;
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(60);
      }
    }

    // The evaluator's probe, verbatim in mechanism: the centre of every row
    // hit-tests to the row itself, never to the scrim behind the panel.
    for (let index = 0; index < 3; index += 1) {
      const hit = await rows.nth(index).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const found = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return found !== null && (found === el || el.contains(found))
          ? "the row"
          : `<${found?.tagName.toLowerCase() ?? "nothing"} .${found?.className ?? ""}>`;
      });
      expect(hit, `weight row ${String(index)} hit-tests to ${hit}`).toBe("the row");
    }

    // …and a real click chooses. The evaluation's click at the heavy row's
    // coordinates dismissed the popover with nothing chosen.
    const heavy = page.locator('[data-address-pop="compose"] [data-weight-key="heavy"]');
    const box = await heavy.boundingBox();
    if (box === null) throw new Error("the heavy row has no box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(card, "the click dismissed the popover instead of choosing").toBeVisible();
    await expect(heavy).toHaveAttribute("aria-pressed", "true");
  });
});
