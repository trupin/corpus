/** @vitest-environment jsdom */
import { FakeEventSource } from "@corpus/kit/testing";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_ATTRIBUTE } from "./shell/theme";
import { memoryStorage } from "./testing/memoryStorage";

/**
 * Adapted for UI-002 with one added global stub. `main.tsx` renders `App`
 * without props, so the kit's provider reaches for `globalThis.EventSource` —
 * which a browser has and neither Node nor jsdom does. Stubbing it keeps this
 * test about mounting rather than about the bridge's backoff loop.
 */

/**
 * ── Why these two tests carry a budget of their own ───────────────────────
 *
 * Both of them `import("./main")`, and `main.tsx` is the app's entry: the
 * import evaluates the whole module graph — React, TipTap, `react-markdown`,
 * every kit stylesheet and all of `./app/App` — before a single assertion runs.
 * `vi.resetModules()` in `beforeEach` means the second test pays for a second
 * evaluation, which is what makes the guard below the throw reachable at all.
 * So this file is the most expensive two tests in the workspace by a wide
 * margin, and it was quietly failing vitest's 5000ms default.
 *
 * **Measured before choosing the number** (2026-08-23, UI-166's session, this
 * laptop shared with other agents; one-minute load average recorded per run).
 * Two contexts, because they behave differently and only one of them is how CI
 * runs this file:
 *
 * | context | load | mounts the shell | fails loudly |
 * | --- | --- | --- | --- |
 * | `vitest run apps/ui` (A) | 3.7 | 4248ms | 2012ms |
 * | `vitest run apps/ui` (B) | 3.4 | 6745ms | 4435ms |
 * | `vitest run apps/ui` (C) | 4.2 | 5485ms | **7610ms** |
 * | `vitest run apps/ui packages/kit` (D) | 3.6 | 3531ms | 910ms |
 * | file alone ×5 | 4.4–6.3 | 3596–4534ms | 224–412ms |
 * | file alone, cold after `npm run build` | — | **7385ms** | 1177ms |
 *
 * D is the run that confirmed the budget — the same command that failed before
 * it, 242 files and 4680 tests green — and it is in the table because it landed
 * at the fast end. Reporting only that one would have hidden C.
 *
 * Every figure above was taken while five orphaned vitest workers from an
 * earlier, unrelated run held ~80% of a core and ~2GB between them. That makes
 * these numbers **conservative** — the at-rest cost is lower — which is the
 * right direction for a budget to be wrong in.
 *
 * Read the spread rather than the minimum. The same test ranges 224ms to
 * 7610ms — **34×** — and the two in-suite extremes of "fails loudly" alone are
 * 3.8× apart at *falling* load, so this is worker scheduling and transform-cache
 * warmth, not simply a busy machine. A budget at the observed maximum would
 * fail about as often as it passed.
 *
 * 20000ms is 2.6× the observed maximum, which is the margin the measured spread
 * itself asks for. It is deliberately **not** a global or file-wide raise: it is
 * on these two tests, which are the only ones in the workspace that mount the
 * entry point.
 *
 * **A narrower import was considered and rejected.** "fails loudly" drags the
 * whole graph in to assert a three-line `#root` guard, so extracting that guard
 * into its own module would make it nearly free. It would also stop proving
 * what the test is for: that **`main.tsx`** refuses to mount into nothing. A
 * helper's own test passes just as well when nobody calls the helper. And it
 * would not remove the budget anyway — "mounts the shell" must evaluate the
 * real entry point, and that is the 7385ms half.
 */
const ENTRY_POINT_BUDGET_MS = 20_000;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("EventSource", FakeEventSource);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("main", () => {
  it(
    "mounts the shell into #root",
    async () => {
      document.body.innerHTML = '<div id="root"></div>';
      await import("./main");

      await waitFor(() => {
        expect(document.querySelector("#root .app")).not.toBeNull();
      });
      expect(document.querySelector("#root .topbar")).not.toBeNull();
      expect(document.querySelector("#root .board")).not.toBeNull();
      expect(document.querySelector("#root .console")).not.toBeNull();
    },
    ENTRY_POINT_BUDGET_MS,
  );

  it(
    "fails loudly when index.html has no mount point",
    async () => {
      await expect(import("./main")).rejects.toThrow(/no #root element/);
    },
    ENTRY_POINT_BUDGET_MS,
  );
});
