import { describe, expect, it } from "vitest";
import { resolveAnchorExact as serverResolveExact } from "../apps/server/src/anchors/resolve.js";
import { parseThreadBody } from "../apps/server/src/core/turns.js";
import {
  ANCHOR_PARITY_CASES,
  parseThreadTurns,
  renderTurn,
  resolveAnchorExact,
  TURN_PARITY_BODIES,
} from "../apps/ui/e2e/serverParity.js";

/**
 * The e2e stub answers `/api` from inside the browser page, so it re-implements
 * what is left of the server's rules (SPEC.md §6): how a text-quote selector
 * resolves, and how a thread file splits into turns. This test is what keeps the
 * copy honest — it runs one fixture set through **both** implementations and
 * fails if either side moves.
 *
 * **The turn half is now half a copy** (UI-091). CONTRACT-044 moved the
 * heading grammar and the fence masking into `@corpus/contract`, so both sides
 * call `turnHeadings` and the regex and the fence scanner `serverParity.ts` used
 * to transcribe are gone. `TURN_PARITY_BODIES` keeps its fixtures because what
 * is still local is real: the span each heading owns and `trimTurnText`, which
 * is `core/turns.ts`'s and cannot be imported across the application boundary.
 * They pin less than they did, which is the direction to keep going — a rule
 * that becomes shared code should lose its fixture, and neither the fence
 * scanner nor the heading grammar has one here.
 *
 * It lives in `scripts/` rather than in either workspace because it is the only
 * place in the repo that may look at two applications at once: `apps/ui` and
 * `apps/server` are siblings, and an import between them would invent a
 * dependency edge (and drag server-only packages into the UI's type program) for
 * the sake of a test. `eslint-boundaries.test.ts` is here for the same reason —
 * cross-workspace invariants are repo tooling's business.
 *
 * **Why it exists at all** (UI-056): the stub used to implement rung 2 alone, so
 * a framed selector for a duplicated phrase — the case §6's prefix/suffix
 * framing is *for* — resolved on the real server and came back `orphaned` from
 * the stub. Every e2e assertion about anchoring was therefore an assertion about
 * the stub. Should anchor resolution ever move into a package both applications
 * can depend on, this file is what should be deleted in exchange.
 */

describe("the e2e stub's anchor resolution", () => {
  it.each(ANCHOR_PARITY_CASES.map((testCase) => [testCase.name, testCase] as const))(
    "agrees with the server — %s",
    (_name, testCase) => {
      const server = serverResolveExact(testCase.body, testCase.selector);
      const stub = resolveAnchorExact(testCase.body, testCase.selector);

      // Three-way: the fixture states what §6 requires, and neither side may
      // drift from it or from the other.
      expect(server).toEqual(testCase.expected);
      expect(stub).toEqual(testCase.expected);
      expect(stub).toEqual(server);
    },
  );

  it("quotes the words the fixture says it does, wherever it resolves", () => {
    for (const testCase of ANCHOR_PARITY_CASES) {
      const range = resolveAnchorExact(testCase.body, testCase.selector);
      if (range === null) continue;
      // Every non-orphan answer is the selector's own text — except the snapped
      // surrogate case, which widens to the whole character by design.
      expect(testCase.body.slice(range.start, range.end)).toContain(testCase.selector.exact);
    }
  });

  it("covers both outcomes, so a resolver that always orphaned would fail", () => {
    const resolved = ANCHOR_PARITY_CASES.filter((testCase) => testCase.expected !== null);
    const orphaned = ANCHOR_PARITY_CASES.filter((testCase) => testCase.expected === null);
    expect(resolved.length).toBeGreaterThan(3);
    expect(orphaned.length).toBeGreaterThan(3);
  });
});

describe("the e2e stub's thread turn parsing", () => {
  it.each(TURN_PARITY_BODIES.map((fixture) => [fixture.name, fixture.body] as const))(
    "agrees with the server — %s",
    (_name, body) => {
      expect(parseThreadTurns(body)).toEqual(parseThreadBody(body).turns);
    },
  );

  it("writes turn headings the server's own parser reads back", () => {
    const turns = [
      { author: "user" as const, ts: "2026-07-01T09:00:00Z", body: "First.", model: null },
      {
        author: "agent" as const,
        ts: "2026-07-01T09:05:00Z",
        body: "Second.\n\nWith a gap.",
        model: null,
      },
    ];
    const body = turns.map((turn) => renderTurn(turn)).join("\n");
    expect(parseThreadBody(body).turns).toEqual(turns);
    expect(parseThreadBody(body).preamble).toBe("");
  });
});
