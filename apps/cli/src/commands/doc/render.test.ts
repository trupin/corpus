import { describe, expect, it } from "vitest";
import { ExitCode, renderError, StaleKeyError, toProblem } from "../../errors.js";
import { DOC, rekeyed } from "./fixtures.js";
import { documentLines, effectLines, otherWarnings, staleKeyError } from "./render.js";

/**
 * SPEC.md §7's refusal, and the two recoveries it has to be able to name.
 *
 * The regression these tests exist for (PR #44 re-review): the refusal is
 * classified once, in `client.ts`, for *every* route — so the keyed message
 * reached `corpus doc patch`, a verb with no `--key`, and told an agent to
 * re-run "with `--key <k>`". A flag that verb refuses at exit 2. The assertions
 * below are therefore as much about what each message must **not** say as about
 * what it says: an agent recovers from the message alone or it does not recover.
 */

const MOVED_ON = rekeyed(DOC, "c0ffee11223344556677889900aabbccddeeff00112233445566778899aabbcc");

/** Everything an agent actually reads, in the shape `renderError` prints it. */
const humanText = (error: StaleKeyError): string => renderError(error, { verbose: false });

describe("staleKeyError — the keyed refusal", () => {
  it("names the fresh key and the flag to resend it in", () => {
    const error = staleKeyError(409, MOVED_ON);

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(error.exitCode).toBe(ExitCode.staleKey);
    expect(error.status).toBe(409);
    expect(error.changed).toBe(false);
    expect(error.hint).toContain(`--key ${MOVED_ON.key}`);
    expect(error.message).toContain("nothing was written");
  });

  it("is what a caller gets when the route is not named at all", () => {
    // The default is keyed because every write but one presents a key: the
    // exception has to ask for itself.
    expect(staleKeyError(409, MOVED_ON).hint).toBe(
      staleKeyError(409, MOVED_ON, { keyed: true }).hint,
    );
  });

  it("prints the document as `corpus doc show` would, so the caller can reconcile", () => {
    const text = humanText(staleKeyError(409, MOVED_ON));

    expect(text).toContain(MOVED_ON.frontmatter.title);
    expect(text).toContain(`key ${MOVED_ON.key}`);
    expect(text).toContain(MOVED_ON.body.trim());
    // Rendered as a document, never as a JSON dump of `details`.
    expect(text).not.toContain('"frontmatter"');
  });

  it("carries the document un-rendered for `--json`", () => {
    expect(staleKeyError(409, MOVED_ON).details).toBe(MOVED_ON);
  });
});

describe("staleKeyError — the refusal of the verb that presents no key", () => {
  it("never mentions `--key`, because `corpus doc patch` has none", () => {
    // The regression, asserted directly: §7 exempts a patch, and the CLI
    // refuses a `--key` on it at exit 2, so a recovery that names the flag is a
    // dead end for the agent following it.
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.message).not.toContain("--key");
    expect(error.hint).not.toContain("--key");
    expect(humanText(error)).not.toContain("--key");
    expect(humanText(error)).not.toContain(MOVED_ON.key);
  });

  it("says the patch is still good and to run the same one again", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.message).toContain("outside Corpus");
    expect(error.message).toContain("nothing was written");
    expect(error.message).toContain("the patch itself is still good");
    expect(error.hint).toContain("Run the same patch again");
  });

  it("names the second step too: exit 10 means the quote is gone, so re-read", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.hint).toContain("exit 10");
    expect(error.hint).toContain(`corpus doc show ${MOVED_ON.frontmatter.id}`);
  });

  it("keeps the classification of the keyed refusal — same code, same exit, nothing written", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(error.code).toBe("stale_key");
    expect(error.exitCode).toBe(ExitCode.staleKey);
    expect(error.status).toBe(409);
    expect(error.changed).toBe(false);
  });

  it("prints no document: the bounded edit does not pay for the whole file to be refused", () => {
    const text = humanText(staleKeyError(409, MOVED_ON, { keyed: false }));

    expect(text).not.toContain(MOVED_ON.body.trim());
    expect(text).not.toContain(MOVED_ON.path);
    expect(text).not.toContain(MOVED_ON.frontmatter.title);
    // And not as a JSON dump either — an empty `detailLines` is what stops
    // `renderError` falling back to stringifying `details`.
    expect(text).not.toContain('"frontmatter"');
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("still carries the document for `--json`, which asked for structure", () => {
    // Dropping it from the human rendering is a token decision, not a data one:
    // a machine caller that wants to check its excerpt against the new body
    // before retrying reads `.error.details.body`.
    expect(staleKeyError(409, MOVED_ON, { keyed: false }).details).toBe(MOVED_ON);
  });
});

describe("the machine surface of the refusal that prompted CLI-042", () => {
  // These build the errors the way production does — `staleKeyError` is what
  // `doc edit` and `doc patch` actually throw — rather than handing the
  // constructor a hint the test wrote. A test that supplies its own hint asserts
  // that `toProblem` copies a field, and would pass if no call site ever set one.

  it("carries the keyed write's recovery, naming the fresh key", () => {
    const problem = toProblem(staleKeyError(409, rekeyed(DOC, "sha-fresh")));
    expect(problem.hint).toContain("--key sha-fresh");
    // The whole point: what to do, not only what happened.
    expect(problem.hint).toContain("run the same command again");
  });

  it("carries the patch's recovery — run it again — which was human-only", () => {
    // The exact defect the issue names: the message says "the patch itself is
    // still good", and the instruction that makes that actionable lived only in
    // the human rendering.
    const problem = toProblem(staleKeyError(409, DOC, { keyed: false }));
    expect(problem.message).toContain("the patch itself is still good");
    expect(problem.hint).toContain("Run the same patch again");
  });

  it("gives the two refusals different recoveries, since they are different events", () => {
    const keyed = toProblem(staleKeyError(409, DOC)).hint;
    const patched = toProblem(staleKeyError(409, DOC, { keyed: false })).hint;
    expect(keyed).not.toBe(patched);
  });
});

describe("the board and workflow keys in `doc show`", () => {
  const withFrontmatter = (patch: Partial<(typeof DOC)["frontmatter"]>) =>
    documentLines({ ...DOC, frontmatter: { ...DOC.frontmatter, ...patch } });

  it("prints nothing for an ordinary note, which carries none of them", () => {
    const lines = documentLines(DOC).join("\n");
    for (const key of ["stage", "order", "default-open", "columns", "kanban"]) {
      expect(lines, `an ordinary note printed ${key}`).not.toContain(key);
    }
  });

  it("prints a stage when the document carries one", () => {
    expect(withFrontmatter({ stage: "triage" })).toContain("stage triage");
  });

  it("prints a board's position and its default-open flag", () => {
    const lines = withFrontmatter({ order: 2, defaultOpen: true });
    expect(lines).toContain("order 2");
    expect(lines).toContain("default-open yes");
  });

  it("prints an order of 0, which is a real position and not an absent key", () => {
    // The guard is `!== null`, not falsiness: `order: 0` is the leftmost board.
    expect(withFrontmatter({ order: 0 })).toContain("order 0");
  });

  it("prints the columns in board order", () => {
    expect(withFrontmatter({ columns: ["doc_a1b2", "doc_c3d4"] })).toContain(
      "columns doc_a1b2, doc_c3d4",
    );
  });

  it("tells an empty column list from an absent one — the Files board has the first", () => {
    expect(withFrontmatter({ columns: [] })).toContain("columns —");
    expect(withFrontmatter({ columns: null }).join("\n")).not.toContain("columns");
  });

  it("flattens a kanban to its field, its stages, its graph and its status map", () => {
    expect(
      withFrontmatter({
        kanban: {
          field: "stage",
          stages: ["triage", "doing", "done"],
          transitions: { triage: ["doing"], doing: ["done", "triage"] },
          status: { done: "resolved" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "kanban over stage: triage, doing, done",
        "  transitions triage → doing · doing → done, triage",
        "  status done → resolved",
      ]),
    );
  });

  it("prints no graph line for an omitted graph, and an explicit one for an empty graph", () => {
    // Absent is the linear funnel; `{}` is a graph nothing may be dragged along.
    expect(withFrontmatter({ kanban: { field: "stage", stages: ["a"] } }).join("\n")).not.toContain(
      "transitions",
    );
    expect(
      withFrontmatter({ kanban: { field: "stage", stages: ["a"], transitions: {} } }),
    ).toContain("  transitions —");
  });
});

describe("the two effect warnings", () => {
  const stageStatus = {
    code: "stage_status" as const,
    detail:
      "stage `done` set status to `resolved`: this document is in the kanban Triage (doc_b0a1), " +
      "whose `kanban.status` map decides a status on entry (SPEC.md §5).",
  };
  const cleared = {
    code: "default_open_cleared" as const,
    detail: "`default-open` was cleared from Attention (doc_o1d2).",
  };
  const commit = { code: "commit_failed" as const, detail: "the hook rejected it" };

  it("hands each effect back verbatim, one line each", () => {
    expect(effectLines([stageStatus, cleared])).toEqual([stageStatus.detail, cleared.detail]);
  });

  it("keeps the whole sentence, past the 120 characters a warning suffix would cut", () => {
    // The board that decided is named after that mark, and it is the one fact a
    // person whose document jumped to `resolved` needs.
    expect(stageStatus.detail.length).toBeGreaterThan(120);
    expect(effectLines([stageStatus])[0]).toContain("doc_b0a1");
  });

  it("leaves every other warning for the success line's suffix, and takes it out of nothing else", () => {
    expect(otherWarnings([stageStatus, commit, cleared])).toEqual([commit]);
    expect(effectLines([commit])).toEqual([]);
  });
});
