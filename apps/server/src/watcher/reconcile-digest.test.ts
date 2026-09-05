// SPEC.md §6's digest rider, signed 2026-09-05 (SERVER-164), on the watcher
// path: an out-of-band edit that deletes or revises a turn a digest covers marks
// the digest stale — in the rewrite `reconcile-out-of-band.ts` already makes, and
// so in the same commit `watcher.ts` makes of it, alongside the person's own
// edit.
//
// A file of its own rather than more cases in `reconcile-out-of-band.test.ts`,
// because this half is about **thread** files and that suite's fixture is a note
// with an anchor: a digest is an account of turns, and a note has none. The HEAD
// reader is injected for the reason that suite's last case gives — what is under
// test is the comparison, not git.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { reconcileOutOfBandEdit } from "./reconcile-out-of-band.js";
import { createSelfWriteRegistry } from "./self-writes.js";

const RELATIVE = "data/threads/th_conversation.md";
const WATERMARK = "2026-09-05T10:00:00Z";
const LATER = "2026-09-05T11:00:00Z";

const TURNS = [
  "",
  "## user · 2026-09-05T09:00:00Z",
  "",
  "What is the rate?",
  "",
  `## agent · ${WATERMARK}`,
  "",
  "Six point one.",
  "",
  `## user · ${LATER}`,
  "",
  "Thanks.",
  "",
].join("\n");

/** The turns with the digest's own turn removed — the deletion case. */
const WITHOUT_COVERED = TURNS.replace(`## agent · ${WATERMARK}\n\nSix point one.\n\n`, "");

const LIVE_DIGEST = [
  "digest:",
  "  body: They settled on six point one.",
  `  watermark: ${WATERMARK}`,
  "  stale: false",
];

const threadWith = (turns: string, digest: readonly string[] = LIVE_DIGEST): string =>
  ["---", "id: th_conversation", "type: thread", "title: The rate", ...digest, "---", turns].join(
    "\n",
  );

let root: string;
let workspace: string;
let absPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s164-digest-"));
  workspace = join(root, "ws");
  absPath = join(workspace, ...RELATIVE.split("/"));
  mkdirSync(dirname(absPath), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const run = (head: string) =>
  reconcileOutOfBandEdit({
    workspaceRoot: workspace,
    absPath,
    relativePath: RELATIVE,
    content: readFileSync(absPath, "utf8"),
    selfWrites: createSelfWriteRegistry(),
    readHead: () => head,
  });

const digestOnDisk = (): unknown => parseDocument(readFileSync(absPath, "utf8")).data["digest"];

describe("reconcileOutOfBandEdit — the digest half", () => {
  it("marks the digest stale when the edit deleted a turn it covers", () => {
    writeFileSync(absPath, threadWith(WITHOUT_COVERED), "utf8");

    const outcome = run(threadWith(TURNS));

    expect(outcome.kind).toBe("reconciled");
    expect(digestOnDisk()).toEqual({
      // The prose is untouched. Repairing it is the resident's act and never the
      // server's, so this pass only ever sets one boolean.
      body: "They settled on six point one.",
      // And the coverage claim is untouched too.
      watermark: WATERMARK,
      stale: true,
    });
  });

  it("registers the rewrite as a self-write, so the watcher does not loop on it", () => {
    writeFileSync(absPath, threadWith(WITHOUT_COVERED), "utf8");
    const selfWrites = createSelfWriteRegistry();

    reconcileOutOfBandEdit({
      workspaceRoot: workspace,
      absPath,
      relativePath: RELATIVE,
      content: readFileSync(absPath, "utf8"),
      selfWrites,
      readHead: () => threadWith(TURNS),
    });

    expect(selfWrites.claim(absPath, readFileSync(absPath))).toBe(true);
  });

  it("hands the caller the bytes it wrote, so the commit holds the flag and the edit", () => {
    writeFileSync(absPath, threadWith(WITHOUT_COVERED), "utf8");

    const outcome = run(threadWith(TURNS));

    expect(outcome.kind === "reconciled" && outcome.text).toBe(readFileSync(absPath, "utf8"));
    // No anchors were reconciled, so the report says nothing and no trailer is
    // built from it.
    expect(outcome.kind === "reconciled" && outcome.report).toEqual({
      unchanged: [],
      remapped: [],
      orphaned: [],
    });
  });

  it("marks it stale when the edit revised a covered turn in place", () => {
    writeFileSync(absPath, threadWith(TURNS.replace("Six point one.", "Six point four.")), "utf8");

    expect(run(threadWith(TURNS)).kind).toBe("reconciled");

    expect(digestOnDisk()).toMatchObject({ stale: true });
  });

  it("leaves it alone when only a turn after the watermark changed", () => {
    writeFileSync(
      absPath,
      threadWith(TURNS.replace("Thanks.", "Thanks, that settles it.")),
      "utf8",
    );

    const outcome = run(threadWith(TURNS));

    expect(outcome.kind).toBe("unchanged");
    expect(digestOnDisk()).toMatchObject({ stale: false });
  });

  it("leaves a digest the same edit rewrote alone — the writer is stating fresh coverage", () => {
    writeFileSync(
      absPath,
      threadWith(WITHOUT_COVERED, [
        "digest:",
        "  body: A fresh account of what is left.",
        `  watermark: ${LATER}`,
        "  stale: false",
      ]),
      "utf8",
    );

    const outcome = run(threadWith(TURNS));

    expect(outcome.kind).toBe("unchanged");
    expect(digestOnDisk()).toMatchObject({ stale: false });
  });

  it("does nothing for a digest that already says it is stale", () => {
    const stale = [
      "digest:",
      "  body: They settled on six point one.",
      `  watermark: ${WATERMARK}`,
      "  stale: true",
    ];
    writeFileSync(absPath, threadWith(WITHOUT_COVERED, stale), "utf8");

    expect(run(threadWith(TURNS, stale))).toEqual({ kind: "skipped", reason: "no anchors" });
  });

  it("skips a thread with no digest and no anchors, exactly as before", () => {
    writeFileSync(absPath, threadWith(TURNS.replace("Thanks.", "Bye."), []), "utf8");

    expect(run(threadWith(TURNS, []))).toEqual({ kind: "skipped", reason: "no anchors" });
  });

  it("skips a body that did not change, however the frontmatter moved", () => {
    writeFileSync(absPath, threadWith(TURNS), "utf8");

    expect(run(threadWith(TURNS, []))).toEqual({ kind: "skipped", reason: "body unchanged" });
  });
});
