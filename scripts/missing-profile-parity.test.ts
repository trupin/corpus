import { MISSING_PROFILE_CAUSES as CONTRACT_MISSING_PROFILE_CAUSES } from "@corpus/contract";
import {
  MISSING_PROFILE_CAUSES,
  MISSING_PROFILE_NOTE,
  type MissingProfileCause,
} from "@corpus/kit";
import {
  ARCHIVING_IS_NOT_A_CAUSE,
  MISSING_PROFILE_CAUSES as CLI_MISSING_PROFILE_CAUSES,
  MISSING_PROFILE_CAUSES_PHRASE,
} from "../apps/cli/src/commands/resident.js";
import { agentsCommand } from "../apps/cli/src/commands/agents.js";
import { designateCommand } from "../apps/cli/src/commands/thread/designate.js";
import { showCommand } from "../apps/cli/src/commands/thread/show.js";
import { renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../apps/server/src/docs/corpus-fixture.js";
import { currentResident } from "../apps/server/src/threads/read.js";
import { MENTION_TYPE, resolveMentionTarget } from "../apps/server/src/threads/mentions.js";

/**
 * **What the product tells a person about a missing profile, against what the
 * workspace can actually do to one.**
 *
 * SPEC.md §7 requires a designation whose profile has gone be *"reported rather
 * than silently substituted"*, and `packages/kit/src/recipient/laneRows.ts`
 * writes that report — one sentence, rendered on the board badge, in the
 * conversation's menu and in the composer's recipient picker. For a release the
 * sentence named **archiving** as one of the ways in. Archiving cannot produce
 * that state: an archived `agent-def` stays under `.claude/agents/`, `targetRows`
 * selects on `type` with no status filter, and `targetIndex`'s only skip is the
 * off-root gate — so its resident keeps its `docId` and stays designatable, and
 * a person with a perfectly working archived profile was told it was gone.
 *
 * ## Why the check is here, and why it is not a word list
 *
 * The same claim was stated at eight sites in one release, and an earlier sweep
 * corrected some of them by searching for the wrong spelling — which is how this
 * one survived. So the sentence is no longer typed: `MISSING_PROFILE_CAUSES` is
 * the list, {@link MISSING_PROFILE_NOTE} is composed from it, and this file
 * pairs each cause with a **workspace act** and asks the real code what that act
 * does.
 *
 * The pairing is by identity — {@link Act.cause} is a `MissingProfileCause` or
 * `null`, checked by the type system — so nothing here matches words against a
 * blacklist. Add archiving back to the causes, in any spelling, and the set
 * equality below fails because no act produces it; drop `deleted`, and it fails
 * because an act produces a cause the sentence does not name.
 *
 * ## The measurement is the production code, not a model of it
 *
 * `currentResident` (`apps/server/src/threads/read.ts`) is the function that
 * fills `Resident.docId` on every read — it re-resolves the stored name through
 * `resolveMentionTarget` rather than repeating a stored id. So each act is
 * applied to a real workspace, the real projector re-reads it, and the answer
 * this file records is the field the UI renders from.
 *
 * It lives in `scripts/` for `stub-server-parity.test.ts`'s reason: `apps/server`
 * and `packages/kit` are not on a dependency path, and this is the one place in
 * the repo that may look at both to ask whether the words match the behaviour.
 */

/** One thing a person can do to a persona, and what the report should call it. */
interface Act {
  readonly name: string;
  /** The cause this act is reported as, or `null` when it must not be reported at all. */
  readonly cause: MissingProfileCause | null;
  /** Applies the act to a seeded workspace, in place. */
  readonly apply: (ws: Workspace) => void;
}

const PERSONA_PATH = ".claude/agents/scratch-persona.md";
const PERSONA_TITLE = "Scratch Persona";
const PERSONA_NAME = "scratch-persona";

const personaFile = (status: string | null): string =>
  `---\nid: doc_scratch1\nname: ${PERSONA_NAME}\ndescription: a persona\ntype: agent-def\n` +
  `title: ${PERSONA_TITLE}\n${status === null ? "" : `status: ${status}\n`}---\nBody.\n`;

const abs = (ws: Workspace, path: string): string => join(ws.config.workspaceRoot, path);

const moveFile = (ws: Workspace, from: string, to: string): void => {
  mkdirSync(dirname(abs(ws, to)), { recursive: true });
  renameSync(abs(ws, from), abs(ws, to));
};

/**
 * The four acts, and the one that is deliberately harmless.
 *
 * **Archiving is modelled as the frontmatter write it is for this type.**
 * `planSetArchived` (`apps/server/src/docs/archive.ts`) computes a folder move
 * only for `type: skill` — `loaded.row.type === "skill" ? planFolderMove(…) :
 * null` — and `folderMove` itself only relocates a path already under one of the
 * two skill roots. For every other type archiving patches `status` and leaves
 * the path, which is the gate's sole input. So writing the same file at the same
 * path with `status: archived` is what the verb does here, and the assertion
 * below checks the projected row really came back archived, so a fixture that
 * quietly failed to archive anything could not pass by doing nothing.
 */
const ACTS: readonly Act[] = [
  {
    name: "archived, which leaves it under the root",
    cause: null,
    apply: (ws) => ws.write(PERSONA_PATH, personaFile("archived")),
  },
  {
    name: "renamed",
    cause: "renamed",
    apply: (ws) => moveFile(ws, PERSONA_PATH, ".claude/agents/renamed-persona.md"),
  },
  {
    name: "deleted",
    cause: "deleted",
    apply: (ws) => rmSync(abs(ws, PERSONA_PATH)),
  },
  {
    name: "moved out of the root",
    cause: "moved out of .claude/agents/",
    apply: (ws) => moveFile(ws, PERSONA_PATH, "data/docs/inbox/scratch-persona.md"),
  },
];

let ws: Workspace | undefined;

/** A workspace holding one persona and a standing designation of it, after `act`. */
function afterAct(act: Act | null): Workspace {
  const workspace = createWorkspace("missing-profile");
  workspace.write(PERSONA_PATH, personaFile(null));
  workspace.reproject();
  // The designation is made against a workspace where the profile resolves —
  // otherwise every arm would start from the state under test.
  expect(resolveMentionTarget(workspace.db, MENTION_TYPE, PERSONA_NAME)).not.toBeNull();
  if (act !== null) {
    act.apply(workspace);
    workspace.reproject();
  }
  ws = workspace;
  return workspace;
}

/** `Resident.docId` as `GET /api/threads/{id}` would report it, for a standing designation. */
const residentAfter = (workspace: Workspace): string | null =>
  currentResident(workspace.db, {
    name: PERSONA_NAME,
    docId: "doc_scratch1",
    weight: null,
    designationId: null,
  })?.docId ?? null;

afterEach(() => {
  ws?.close();
  ws = undefined;
});

describe("what the workspace can do to a designated profile", () => {
  it.each(ACTS.map((act) => [act.name, act] as const))(
    "empties the resident's docId exactly when the report names it — %s",
    (_name, act) => {
      const workspace = afterAct(act);
      // The report names this act ⇔ the act actually empties the field. Both
      // directions in one assertion, so a fix to either side that forgets the
      // other fails here.
      expect([act.name, residentAfter(workspace) === null]).toEqual([act.name, act.cause !== null]);
    },
  );

  /**
   * Non-vacuity: with no act applied the designation resolves, so the arms above
   * are measuring a change rather than a workspace that never worked.
   */
  it("resolves the designation while the profile is untouched", () => {
    expect(residentAfter(afterAct(null))).toBe("doc_scratch1");
  });

  /**
   * The archived arm, stated **positively** rather than as the absence of a
   * failure — which is the shape the false claim survived a sweep by hiding in.
   *
   * Three separate facts, because "still resolves" alone would pass against a
   * fixture that never archived anything: the projected row really is archived,
   * the resident keeps the id it had, and the profile is still **designatable**
   * — `resolveMentionTarget` is the lookup `POST /api/threads/{id}/resident`
   * makes, so a person can designate an archived persona today.
   */
  it("keeps an archived profile resolving, designatable, and archived", () => {
    const workspace = afterAct(ACTS[0] as Act);

    const row = workspace.db
      .prepare("SELECT id, path, status FROM documents WHERE id = ?")
      .get("doc_scratch1") as { id: string; path: string; status: string } | undefined;
    expect(row?.status).toBe("archived");
    expect(row?.path).toBe(PERSONA_PATH);

    expect(residentAfter(workspace)).toBe("doc_scratch1");
    expect(resolveMentionTarget(workspace.db, MENTION_TYPE, PERSONA_NAME)?.docId).toBe(
      "doc_scratch1",
    );
    // …under the title too, which is the spelling the board's designate menu
    // sends: an archived persona is offerable as well as resolvable.
    expect(resolveMentionTarget(workspace.db, MENTION_TYPE, PERSONA_TITLE)?.docId).toBe(
      "doc_scratch1",
    );
  });
});

describe("the sentence the product shows for a missing profile", () => {
  /**
   * The pin itself: the causes the report names are **exactly** the acts that
   * empty the field, compared as a set of causes rather than as prose.
   *
   * This is what fires when somebody re-adds archiving. It cannot be satisfied
   * by rewording, because the comparison never reads the sentence — it reads the
   * list the sentence is built from, and every member of that list has to be
   * produced by an act measured above.
   */
  it("names exactly the acts that empty the resident's docId", () => {
    const emptying = ACTS.flatMap((act) => (act.cause === null ? [] : [act.cause]));
    expect(new Set(emptying)).toEqual(new Set(MISSING_PROFILE_CAUSES));
    // Every cause is a distinct act, so a duplicated entry cannot stand in for a
    // missing one.
    expect(emptying).toHaveLength(MISSING_PROFILE_CAUSES.length);
  });

  /**
   * …and the sentence is that list, so the check above is a check on what a
   * person reads.
   *
   * Equality with the composition, not a substring search: a hand-written note
   * that dropped the derivation is how this claim would come back, and it is the
   * one bypass the set comparison cannot see.
   */
  it("is composed from those causes and says nothing else", () => {
    const [renamed, deleted, moved] = MISSING_PROFILE_CAUSES;
    expect(MISSING_PROFILE_NOTE).toBe(
      `its profile is gone — ${renamed}, ${deleted}, or ${moved} since`,
    );
    for (const cause of MISSING_PROFILE_CAUSES) expect(MISSING_PROFILE_NOTE).toContain(cause);
  });

  /**
   * The harmless act, checked against the sentence directly — the one place a
   * word does appear, and deliberately so.
   *
   * `ACTS[0].cause` is `null` by declaration and measured `null` above, so this
   * asserts the sentence does not name it by *any* of the spellings a person
   * would recognise. It is the belt to the set comparison's braces: the set
   * catches a cause added to the list, this catches a sentence that grew the
   * claim back some other way.
   */
  it("does not name archiving, in any of the spellings a reader would know", () => {
    expect(ACTS[0]?.cause).toBeNull();
    for (const spelling of ["archiv", "disabl", "deactivat", "retired", "skills-archived"]) {
      expect(MISSING_PROFILE_NOTE.toLowerCase()).not.toContain(spelling);
    }
  });
});

/**
 * **The same claim in `apps/cli`'s help text** (SHARED-054).
 *
 * PR #50's fourth review found five sites outside the kit's reach still typing
 * the causes as prose, four of them here. They are composed now, from
 * `apps/cli/src/commands/resident.ts`'s own array.
 *
 * That array cannot be an import of the kit's: `apps/cli` does not depend on
 * `@corpus/kit` and must not (CLAUDE.md fixes the dependency direction). So the
 * two independent statements are compared here instead — both against the acts
 * measured above, which is the standard the file already holds, and against each
 * other, which is what makes the comparison an equality rather than two lists
 * that merely happen to be the same length.
 *
 * **Still outstanding**: `packages/contract/src/schemas/agents.ts` states the
 * causes twice more, in the published `docId` description. That half of
 * SHARED-054 is unfinished, and this file does not yet reach it.
 */
describe("the same causes, as `apps/cli`'s help states them", () => {
  it("names exactly the acts that empty the resident's docId", () => {
    const emptying = ACTS.flatMap((act) => (act.cause === null ? [] : [act.cause]));
    // Measured against the workspace, not against the kit — so the CLI would
    // still be caught if both copies were edited the same wrong way.
    expect(new Set(CLI_MISSING_PROFILE_CAUSES)).toEqual(new Set(emptying));
  });

  it("is the same list the kit holds, spelled the same way", () => {
    // Byte-identical on purpose: two renderings of one cause would be a reason
    // to keep two lists, which is the shape this whole issue is about.
    expect([...CLI_MISSING_PROFILE_CAUSES]).toEqual([...MISSING_PROFILE_CAUSES]);
  });

  it("composes the phrase from that list and adds nothing to it", () => {
    const [renamed, deleted, moved] = CLI_MISSING_PROFILE_CAUSES;
    // The one difference from the kit's note, and it is a rendering: help text
    // is markdown, so the root is code-quoted.
    expect(MISSING_PROFILE_CAUSES_PHRASE).toBe(
      `${renamed}, ${deleted}, or ${(moved ?? "").replace(".claude/agents/", "`.claude/agents/`")}`,
    );
  });

  it("reaches every help block that used to type the causes", () => {
    // A restatement worded to dodge the vocabulary cannot pass: the assertion is
    // containment of the *composed* string, which only interpolation produces.
    for (const command of [agentsCommand, designateCommand, showCommand]) {
      expect([command.name, command.description?.includes(MISSING_PROFILE_CAUSES_PHRASE)]).toEqual([
        command.name,
        true,
      ]);
    }
  });

  it("keeps the true half beside the corrected one at every block", () => {
    // SHARED-053 removed archiving from the causes. A reader just told three
    // ways a profile can vanish will assume archiving is a fourth unless the
    // block says otherwise, so the sentence travels with the list.
    expect(ACTS[0]?.cause).toBeNull();
    for (const command of [agentsCommand, designateCommand, showCommand]) {
      expect([command.name, command.description?.includes(ARCHIVING_IS_NOT_A_CAUSE)]).toEqual([
        command.name,
        true,
      ]);
    }
  });

  it("never names archiving inside the causes themselves", () => {
    for (const spelling of ["archiv", "disabl", "deactivat", "retired"]) {
      expect(MISSING_PROFILE_CAUSES_PHRASE.toLowerCase()).not.toContain(spelling);
    }
  });
});

/**
 * **The same list, declared twice, held equal** — SHARED-054.
 *
 * `packages/kit` declares {@link MISSING_PROFILE_CAUSES} for the surfaces a
 * person reads, and `packages/contract` declares
 * {@link CONTRACT_MISSING_PROFILE_CAUSES} for the description published on
 * `Resident.docId` — the sentence four domains read. Two declarations, because
 * the dependency direction is fixed (`packages/contract` ← `packages/kit`) and
 * the kit's copy has not yet become a re-export of the contract's.
 *
 * Two declarations with nothing between them is the exact shape SHARED-053's
 * four false statements came out of, so this pins them by **set equality in both
 * directions**, never by either being a superset. It lives here for this file's
 * own reason: `scripts/` is the one tree allowed to look at two packages that
 * are not on a dependency path.
 *
 * The pin is deliberately narrow. Everything above measures whether the list is
 * *true* against a real workspace, and needs only one list to do it — so when
 * the kit becomes a re-export, this block is deleted rather than rewritten.
 */
describe("the contract publishes the same causes the kit renders", () => {
  it("names the same set, in both directions", () => {
    expect(new Set(CONTRACT_MISSING_PROFILE_CAUSES)).toEqual(new Set(MISSING_PROFILE_CAUSES));
    expect(CONTRACT_MISSING_PROFILE_CAUSES).toHaveLength(MISSING_PROFILE_CAUSES.length);
  });

  /**
   * Order too, since both compose a three-item English clause from indices — a
   * reordered array would leave the two sentences reading differently while a
   * set comparison stayed green.
   */
  it("keeps them in the same order, because both compose a sentence from it", () => {
    expect([...CONTRACT_MISSING_PROFILE_CAUSES]).toEqual([...MISSING_PROFILE_CAUSES]);
  });

  /**
   * And the acts measured above answer for the contract's copy as well, stated
   * rather than inferred: every cause the contract publishes is produced by an
   * act this file applied to a real workspace.
   */
  it("publishes only causes an act above actually produces", () => {
    const measured = new Set<string>(
      ACTS.flatMap((act) => (act.cause === null ? [] : [act.cause])),
    );
    for (const cause of CONTRACT_MISSING_PROFILE_CAUSES) {
      expect(measured, cause).toContain(cause);
    }
  });
});
