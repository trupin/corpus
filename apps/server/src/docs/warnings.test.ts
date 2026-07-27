// SPEC.md §14's warnings, on the wire.
//
// Every assertion here goes through a real request against the real app, and
// parses the response with the contract's own schema — the point of the field is
// that a client sees it, so a test that read `MutationResult` directly would
// prove nothing about what got serialized. The pipeline's internal behaviour
// (what a hook failure does to the file, the projection and the SSE frame) is
// covered in `write.test.ts`; this file is only about what reaches the client.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DeleteDocResultSchema,
  DocMutationResponseSchema,
  UpdateDocResponseSchema,
} from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

/** A `pre-commit` hook that always refuses, with recognisable output. */
function refuseCommits(workspace: WriteWorkspace): void {
  const hook = join(workspace.root, ".git", "hooks", "pre-commit");
  mkdirSync(join(workspace.root, ".git", "hooks"), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\necho 'doc check: refusing' >&2\nexit 1\n", "utf8");
  chmodSync(hook, 0o755);
}

const ANCHOR = "anc_warn0001";
const QUOTE = "The rate is fixed for five years.";
const BODY = ["Intro paragraph.", "", QUOTE, "", "Closing paragraph."].join("\n");

const ANCHORED_DOC = [
  "---",
  "id: doc_warnanch",
  "type: note",
  "title: Mortgage options",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors:",
  `  ${ANCHOR}:`,
  `    exact: ${JSON.stringify(QUOTE)}`,
  `    prefix: ${JSON.stringify("Intro paragraph.\n\n")}`,
  `    suffix: ${JSON.stringify("\n\nClosing paragraph.")}`,
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "---",
  "",
  BODY,
  "",
].join("\n");

const THREAD_DOC = [
  "---",
  "id: th_warn0001",
  "type: thread",
  "title: About the rate",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors: {}",
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "parent: doc_warnanch",
  `anchor: ${ANCHOR}`,
  "agent: none",
  "---",
  "",
  "## user · 2026-07-01T00:00:00Z",
  "",
  "Is this right?",
  "",
].join("\n");

function anchored(name: string): WriteWorkspace {
  ws = createWriteWorkspace(name);
  ws.write("data/docs/inbox/mortgage.md", ANCHORED_DOC);
  ws.write("data/threads/th_warn0001.md", THREAD_DOC);
  ws.git("add", "-A", "--", "data");
  ws.git("commit", "-m", "seed the anchored document");
  ws.reproject();
  return ws;
}

describe("§14 warnings on mutation responses", () => {
  it("returns 200 and a commit_failed warning when a hook rejects the auto-commit", async () => {
    ws = createWriteWorkspace("warn-hook");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Hooked", body: "before" });
    ws.advance(60_000);
    refuseCommits(ws);

    const response = await ws.put(`/api/docs/${created.id}`, { body: "after the hook refused" });

    // The status code is untouched: §14's warning never turns a completed write
    // into a failure, because the file is the source of truth.
    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]?.code).toBe("commit_failed");
    expect(payload.warnings[0]?.detail).toContain("doc check: refusing");
    // And the response describes the write that actually stands on disk.
    expect(payload.doc.body).toContain("after the hook refused");
    expect(ws.read(created.path)).toContain("after the hook refused");
  });

  it("returns an empty warnings array for a clean mutation on every verb", async () => {
    ws = createWriteWorkspace("warn-clean");
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Clean" });
    expect(created.warnings).toEqual([]);

    ws.advance(60_000);
    const edited = await ws.put(`/api/docs/${created.id}`, { body: "edited" });
    expect(edited.status).toBe(200);
    expect(UpdateDocResponseSchema.parse(await edited.json()).warnings).toEqual([]);

    for (const call of [
      () => ws.post(`/api/docs/${created.id}/move`, { folder: "finance" }),
      () => ws.post(`/api/docs/${created.id}/archive`, {}),
      () => ws.post(`/api/docs/${created.id}/unarchive`, {}),
    ]) {
      ws.advance(60_000);
      const response = await call();
      expect(response.status).toBe(200);
      expect(DocMutationResponseSchema.parse(await response.json()).warnings).toEqual([]);
    }

    ws.advance(60_000);
    const deleted = await ws.del(`/api/docs/${created.id}`);
    expect(DeleteDocResultSchema.parse(await deleted.json()).warnings).toEqual([]);
  });

  it("warns commit_skipped on every verb in a workspace with no git repository", async () => {
    ws = createWriteWorkspace("warn-no-git", { git: false });
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Gitless" });
    expect(created.warnings).toEqual([
      { code: "commit_skipped", detail: "the workspace is not a git repository" },
    ]);

    ws.advance(60_000);
    const deleted = await ws.del(`/api/docs/${created.id}`);
    expect(DeleteDocResultSchema.parse(await deleted.json()).warnings).toEqual([
      { code: "commit_skipped", detail: "the workspace is not a git repository" },
    ]);
  });

  it("warns orphaned_anchor on the PUT that detaches a thread", async () => {
    anchored("warn-orphan");

    const response = await ws.put("/api/docs/doc_warnanch", {
      body: ["Intro paragraph.", "", "Closing paragraph."].join("\n"),
    });

    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    // The reconciliation report and the warning are two views of one fact: the
    // report is machine-readable causality, the warning is what §14 asks to
    // surface to a human.
    expect(payload.anchors.orphaned).toEqual([ANCHOR]);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]?.code).toBe("orphaned_anchor");
    expect(payload.warnings[0]?.detail).toContain(ANCHOR);
  });

  it("does not warn when the same edit only moves the anchored text", async () => {
    anchored("warn-orphan-not");

    const response = await ws.put("/api/docs/doc_warnanch", {
      body: ["A new opening paragraph.", "", ...BODY.split("\n")].join("\n"),
    });

    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.anchors.orphaned).toEqual([]);
    expect(payload.warnings).toEqual([]);
  });

  it("warns unresolved_ref only for a ref that names no document", async () => {
    ws = createWriteWorkspace("warn-refs");
    ws.reproject();
    const target = await createDoc(ws, { type: "note", title: "Target" });
    const source = await createDoc(ws, { type: "note", title: "Source" });

    ws.advance(60_000);
    const dangling = await ws.put(`/api/docs/${source.id}`, {
      body: "See [[doc_absent1]] for details.",
    });
    const danglingPayload = UpdateDocResponseSchema.parse(await dangling.json());
    expect(danglingPayload.warnings).toEqual([
      { code: "unresolved_ref", detail: expect.stringContaining("doc_absent1") as string },
    ]);

    // The checker is handed one file per save, so this is the case that only
    // passes because the corpus is consulted: the target exists, just not in
    // the set being validated.
    ws.advance(60_000);
    const resolvable = await ws.put(`/api/docs/${source.id}`, {
      body: `See [[${target.id}]] for details.`,
    });
    expect(UpdateDocResponseSchema.parse(await resolvable.json()).warnings).toEqual([]);
  });

  it("carries both families at once when a hook refuses a save that also orphans", async () => {
    anchored("warn-both");
    refuseCommits(ws);

    const response = await ws.put("/api/docs/doc_warnanch", {
      body: ["Intro paragraph.", "", "Closing paragraph.", "", "See [[doc_absent1]]."].join("\n"),
    });

    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    // Validation first, then the commit — the order the pipeline ran in.
    expect(payload.warnings.map((warning) => warning.code)).toEqual([
      "orphaned_anchor",
      "unresolved_ref",
      "commit_failed",
    ]);
  });
});
