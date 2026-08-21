import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAnchorExact as serverResolveExact } from "../apps/server/src/anchors/resolve.js";
import { parseThreadBody } from "../apps/server/src/core/turns.js";
import { createWorkspace, type Workspace } from "../apps/server/src/docs/corpus-fixture.js";
import { unknownRecipient } from "../apps/server/src/errors.js";
import { DOCUMENT_ROOTS, SKILL_FILENAME } from "../apps/server/src/projection/index.js";
import {
  MENTION_TYPE,
  NO_MENTIONS,
  invocableName as serverInvocableName,
  resolveMentionTarget,
} from "../apps/server/src/threads/mentions.js";
import { decideParticipation } from "../apps/server/src/threads/participation.js";
import {
  ANCHOR_PARITY_CASES,
  invocableAgentName,
  nextThreadStatus,
  parseThreadTurns,
  renderTurn,
  resolveAgentDefName,
  resolveAnchorExact,
  TURN_PARITY_BODIES,
  type StubTargetRow,
} from "../apps/ui/e2e/serverParity.js";
import { unknownRecipientBody } from "../apps/ui/src/testing/serverRefusals.js";

/**
 * The e2e stub answers `/api` from inside the browser page, so it re-implements
 * what is left of the server's rules: how a text-quote selector resolves and how
 * a thread file splits into turns (SPEC.md §6), and which persona a designation
 * names (§7, §8). This test is what keeps the copies honest — it runs one
 * fixture set through **both** implementations and fails if either side moves.
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

/**
 * §8's reopen, in both implementations (UI-085).
 *
 * The stub answers `POST /api/threads/{id}/turns` and therefore has to decide
 * what the turn leaves the thread's `status` as. The server decides it inside
 * `decideParticipation`, where it is deliberately a fact about the **author**
 * and nothing else, so the matrix below varies the two inputs the stub's copy
 * takes and the two it does not — an explicit `requestsAgent` either way, and
 * the thread's `agent` state — and asserts both sides agree on every cell.
 *
 * The cell that matters is the agent's turn on a resolved thread: a copy that
 * reopened unconditionally passes every user-authored case and silently makes
 * "a conversation the agent closes stays closed" untestable from the board.
 */
describe("the e2e stub's copy of §8's reopen", () => {
  const authors = ["user", "agent"] as const;
  const statuses = ["open", "resolved"] as const;
  const agents = ["none", "requested", "engaged"] as const;
  const asks = [undefined, true, false];

  const cells = statuses.flatMap((status) =>
    authors.flatMap((author) =>
      agents.flatMap((agent) =>
        asks.map((requestsAgent) => ({ status, author, agent, requestsAgent })),
      ),
    ),
  );

  it.each(
    cells.map(
      (cell) =>
        [
          `${cell.author} turn on a ${cell.status}/${cell.agent} thread, requestsAgent=${String(cell.requestsAgent)}`,
          cell,
        ] as const,
    ),
  )("agrees with the server — %s", (_name, cell) => {
    const server = decideParticipation({
      requestsAgent: cell.requestsAgent,
      author: cell.author,
      // No mentions: the sentence under test is about the author, and a parsed
      // `@agent` would only move the *enqueue* half of the decision.
      parsed: NO_MENTIONS,
      thread: { agent: cell.agent, status: cell.status },
    });
    expect(nextThreadStatus(cell.status, cell.author)).toBe(server.status);
  });

  it("covers both outcomes, so a copy that never reopened would fail", () => {
    expect(nextThreadStatus("resolved", "user")).toBe("open");
    expect(nextThreadStatus("resolved", "agent")).toBe("resolved");
    expect(nextThreadStatus("open", "user")).toBe("open");
  });
});

/**
 * The UI's copy of a **refusal body** (UI-120), which is the same class of copy
 * as the two above and had drifted in the same silent way.
 *
 * `apps/ui` cannot import `apps/server`, so every fixture that wants to answer
 * the server's `422 unknown_recipient` carries a transcription of a message the
 * server builds. There were three, and two had drifted — one had dropped the
 * recovery sentence, one was a wholly different sentence — while every assertion
 * in the repo matched the substring `names no lane`, which all three still
 * contained. UI-120 reduced them to the one in
 * `apps/ui/src/testing/serverRefusals.ts`; this is what makes that one a
 * transcription. Change the server's wording and this fails, which is the whole
 * ask: a double that words the refusal differently from the server can certify a
 * message a person will never see.
 *
 * Whole body, not just the prose: `code` and `recipient` are what a composer
 * branches on to drop the stale roster row, so a double right about the sentence
 * and wrong about the shape is the same failure one field over.
 *
 * `unknownLaneScope` — the same code with a `scope`-flavoured message — has no
 * double to pin: the UI never parks, so nothing in `apps/ui` answers it. Add a
 * case here the day one does.
 */
describe("the UI fixtures' copy of a server refusal", () => {
  it.each(["th_9k2", "orchestrator", "th_a-b_c"])(
    "words `422 unknown_recipient` exactly as the server does — %s",
    (lane) => {
      expect(unknownRecipientBody(lane)).toEqual(unknownRecipient(lane).body);
    },
  );

  it("is checked against a message that actually varies with the value", () => {
    // Non-vacuity: an equality test over a constant would pass against a copy
    // that ignored its argument. The server's message names the value, so the
    // two ids above cannot produce the same body.
    expect(unknownRecipientBody("th_9k2").message).not.toBe(
      unknownRecipientBody("th_a-b_c").message,
    );
    expect(unknownRecipient("th_9k2").status).toBe(422);
  });
});

/**
 * **Which persona a name designates** — the stub's third copy of a server rule,
 * and the one that had nothing watching it.
 *
 * `POST /api/threads/{id}/resident` names an `agent-def` (SPEC.md §7) and the
 * server resolves it exactly as a `@<subagent>` mention resolves (§8):
 * `resolveMentionTarget`, gated on the invocable name, aliased by the stem *and*
 * the title, keyed through one `aliasKey` on both sides. The stub answers that
 * route from inside the page, so it decides the same question — and a stub that
 * decides it differently lets a Playwright spec certify a designation the real
 * server refuses, which is the failure this whole file exists to stop.
 *
 * It had already happened twice by PR #50's third review. The stub was one
 * release behind on the title alias (PR #49), and then it keyed `row.title`
 * **untrimmed** against a trimmed needle while the server keyed both sides
 * through `aliasKey` — so a persona titled `"  Padded Persona  "`, a title the
 * projector carries verbatim, `404`'d in the browser and `200`'d against the
 * real server. Nothing failed, in a PR whose thesis is that two copies of a rule
 * drift.
 *
 * ## The shape of the comparison
 *
 * A real workspace, projected by the real projector, so the rows both sides are
 * asked about are `documents` rows rather than this file's idea of one. Then
 * every name in {@link spellings} is put to `resolveMentionTarget` and to
 * `resolveAgentDefName` and the two answers must be equal — not merely both
 * non-null, since resolving to the *wrong* document is the failure mode a
 * collision produces.
 *
 * **The rows go to the stub reversed.** Its store is a `Map` in the order a spec
 * seeded it, while the server's index is built `ORDER BY id`; handing the stub
 * the same order the server used would make the id-order tie-break agree for the
 * wrong reason. {@link COLLIDING} is the pair that makes that tie-break
 * observable.
 */
describe("the e2e stub's designation resolution", () => {
  let ws: Workspace;

  /**
   * One candidate path per root and per shape any root has — the flat file, the
   * nested one, and the `SKILL.md` tree — so the fixture asks about a shape
   * every root admits without this file deciding which root admits which.
   *
   * Derived rather than written out for `mention-offer-parity.test.ts`'s reason:
   * what a parity fixture is worth is exactly the set of paths it thinks to ask
   * about, and a hand-written list is a test of the shapes whoever wrote it
   * happened to imagine. A root added to `DOCUMENT_ROOTS` produces new rows here
   * with nobody editing this file.
   */
  const DERIVED: readonly string[] = DOCUMENT_ROOTS.flatMap((root) => [
    `${root.path}/${root.key}-flat.md`,
    `${root.path}/nested/${root.key}-deep.md`,
    `${root.path}/${root.key}-tree/${SKILL_FILENAME}`,
  ]);

  /**
   * Two personas whose stem and title cross: `alpha.md` is titled `Beta`, so the
   * key `beta` is claimed by **both** rows and the first in id order takes it.
   * Ids are chosen so the winner is *not* the row whose stem it is, which is
   * what makes the tie-break visible rather than merely exercised.
   *
   * They are also the shape a declared id survives: `DocumentIdSchema` is
   * `^(doc|th)_[A-Za-z0-9]+$` and `readDocumentFields` synthesizes one from the
   * path for anything else, so an id spelled any other way here would be
   * silently replaced by a sha1 digest and the ordering would be a coin toss.
   */
  const COLLIDING = [
    { id: "doc_col1", path: ".claude/agents/alpha.md", title: "Beta" },
    { id: "doc_col2", path: ".claude/agents/beta.md", title: "Gamma" },
  ] as const;

  /** …and the title shape the projector carries verbatim. */
  const PADDED_PATH = ".claude/agents/padded.md";

  beforeAll(() => {
    ws = createWorkspace("stub-designations");

    // The shape the `profile` skill writes since SERVER-122: the title is not
    // the stem, and both spellings resolve.
    ws.doc({
      id: "doc_book1",
      path: ".claude/agents/bookkeeper.md",
      type: MENTION_TYPE,
      title: "Bookkeeper",
    });
    // Quoted, because YAML strips the padding off a plain scalar and the padding
    // reaching `documents.title` is the entire point of this row (PR #50 NIT 7).
    ws.write(
      PADDED_PATH,
      '---\nid: doc_pad1\nname: padded\ndescription: a persona\ntype: agent-def\ntitle: "  Padded Persona  "\n---\nBody.\n',
    );
    for (const row of COLLIDING) {
      ws.doc({ id: row.id, path: row.path, type: MENTION_TYPE, title: row.title });
    }
    // The document *about* a persona, filed where an explicit `--folder` still
    // puts it (SERVER-122): a row on the far side of the gate, addressable under
    // no spelling including its own title (SERVER-125).
    ws.doc({
      id: "doc_legacy1",
      path: "data/docs/inbox/legacy.md",
      type: MENTION_TYPE,
      title: "Legacy",
    });
    DERIVED.forEach((path, index) => {
      ws.doc({
        id: `doc_d${String(index).padStart(2, "0")}`,
        path,
        type: MENTION_TYPE,
        // Unique, one word, and unlike every stem in the fixture: a row whose
        // title is its stem cannot tell the title alias from the name.
        title: `Derived${index}`,
      });
    });

    ws.reproject();
  });

  afterAll(() => {
    ws.close();
  });

  /** Rows as `GET /api/docs?type=agent-def` reports them, straight off the projection. */
  const directory = (): readonly StubTargetRow[] =>
    ws.db
      .prepare("SELECT id, path, title FROM documents WHERE type = ? ORDER BY id")
      .all(MENTION_TYPE) as StubTargetRow[];

  /** What the stub's `Map` hands its resolver: the same rows, in some other order. */
  const stubRows = (): readonly StubTargetRow[] => [...directory()].reverse();

  /**
   * Every spelling worth asking about: the two aliases a row has, each cased and
   * padded the ways a caller produces them, plus names that must resolve to
   * nothing.
   *
   * The padded and cased variants are not decoration — they are the two halves
   * of `aliasKey`, and each one is a way the copies have already drifted. The
   * board's designate menu sends a **trimmed** title (`residentActions.ts`)
   * while the projection holds the padded one, so `"Padded Persona"` against a
   * row titled `"  Padded Persona  "` is the exact request MINOR 4 was about.
   */
  const spellings = (): readonly string[] => [
    ...directory().flatMap((row) => [
      row.title,
      row.title.trim(),
      row.title.toUpperCase(),
      `  ${row.title.trim()}  `,
      row.path.split("/").at(-1)?.replace(/\.md$/, "") ?? "",
      (row.path.split("/").at(-1)?.replace(/\.md$/, "") ?? "").toUpperCase(),
      row.id,
    ]),
    "",
    "   ",
    "nobody",
    "agent",
  ];

  /**
   * Non-vacuity, first: with a directory holding nothing, or nothing on one side
   * of the gate, every agreement below would hold of a resolver that answered
   * `null` to everything and of one that answered the first row to everything.
   */
  it("is asked over a directory with rows on both sides of the gate", () => {
    const rows = directory();
    expect(rows.filter((row) => invocableAgentName(row.path) !== null).length).toBeGreaterThan(3);
    expect(rows.filter((row) => invocableAgentName(row.path) === null).length).toBeGreaterThan(0);
    // …and the questions land on both answers, so neither branch is untested.
    const answers = spellings().map((name) => resolveMentionTarget(ws.db, MENTION_TYPE, name));
    expect(answers.filter((target) => target !== null).length).toBeGreaterThan(3);
    expect(answers.filter((target) => target === null).length).toBeGreaterThan(3);
  });

  /**
   * The narrowing, stated rather than assumed. The stub names only
   * `.claude/agents/<stem>.md` while the server classifies against all five
   * roots — which is sound *because* every other root overrides the
   * frontmatter's type (`roots.ts`), so no other root can produce an
   * `agent-def` row for the two to disagree about. This is where that stops
   * being true: an agent-def is seeded at every shape every root admits, and the
   * two namings are compared over whatever the projector actually made rows of.
   *
   * The projected rows are the **whole** domain — a path with no row is a path
   * this rule is never handed — so equality over them is the claim, not a
   * sample of it.
   */
  it("names every projected agent-def row exactly as the server names it", () => {
    const rows = directory();
    expect(rows.length).toBeGreaterThan(DOCUMENT_ROOTS.length);
    const divergent = rows.filter(
      (row) => invocableAgentName(row.path) !== serverInvocableName(row.path),
    );
    expect(divergent).toEqual([]);
  });

  /**
   * …and the other direction, which the rows alone cannot reach: the stub may be
   * **narrower** than the server, never wider and never differently spelled.
   *
   * A row is only ever handed paths the projector produced, so a regex widened
   * to `.claude/agents/**` would name a nested file no directory holds and the
   * test above would never see it — there is no such row to compare. Asked over
   * the derived paths instead, including the ones no root admits, the widening
   * is a failure here.
   */
  it("names nothing the server does not name, over every derived path", () => {
    const wider = DERIVED.filter((path) => {
      const stub = invocableAgentName(path);
      return stub !== null && stub !== serverInvocableName(path);
    });
    expect(wider).toEqual([]);
  });

  /** The comparison itself: one name, both resolvers, the same answer. */
  it("resolves every spelling to the document the server resolves it to", () => {
    const rows = stubRows();
    for (const name of spellings()) {
      const server = resolveMentionTarget(ws.db, MENTION_TYPE, name);
      const stub = resolveAgentDefName(rows, name);
      expect([name, stub]).toEqual([
        name,
        server === null ? null : { docId: server.docId, name: server.name },
      ]);
    }
  });

  /**
   * The regression MINOR 4 named, called out on its own so a failure says what
   * broke rather than naming one of forty spellings: a padded title is carried
   * verbatim by the projector and keyed **trimmed** by both sides, so the
   * trimmed name the designate menu sends lands on the row.
   */
  it("resolves a padded title under the trimmed name the designate menu sends", () => {
    const padded = directory().find((row) => row.path === PADDED_PATH);
    expect(padded?.title).toBe("  Padded Persona  ");
    for (const spelling of ["Padded Persona", "  Padded Persona  ", "padded persona", "padded"]) {
      expect(resolveAgentDefName(stubRows(), spelling)).toEqual({
        docId: padded?.id,
        name: "padded",
      });
    }
  });

  /**
   * And the tie-break, likewise: the key `beta` is claimed by two rows and goes
   * to the first in **id** order, which is not the row the stub was handed
   * first and not the row whose stem it is.
   */
  it("breaks a collision by id order, whatever order the store holds", () => {
    expect(resolveAgentDefName(stubRows(), "beta")).toEqual({
      docId: COLLIDING[0].id,
      name: "alpha",
    });
  });

  /**
   * The gate, last: an off-root row resolves under no spelling on either side —
   * the SERVER-125 half the stub was a release behind on, and the half a menu
   * offering `Legacy` would need in order to be wrong quietly.
   */
  it("refuses the document about a persona, under its title, on both sides", () => {
    const legacy = directory().find((row) => row.path === "data/docs/inbox/legacy.md");
    expect(legacy?.title).toBe("Legacy");
    for (const spelling of ["Legacy", "legacy", "  legacy  "]) {
      expect(resolveMentionTarget(ws.db, MENTION_TYPE, spelling)).toBeNull();
      expect(resolveAgentDefName(stubRows(), spelling)).toBeNull();
    }
  });
});
