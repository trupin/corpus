import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { ExitCode, isCliError } from "../../errors.js";
import { templateManifestPath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { registry } from "../../registry/index.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  type StubServer,
} from "../../testing/stub-server.js";
import { readTemplateManifest, serializeManifest, sha256 } from "../../template/manifest.js";
import { commitAll, initRepository } from "../init/git.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import { runWorkspaceMerge } from "./merge.js";
import { ensureMaintenanceSettings } from "./maintenance.js";
import { runWorkspaceUpgrade } from "./upgrade.js";

/**
 * The merge verb end to end: a real scaffolded workspace with a real git
 * history (where the baseline bytes live), a real template tree standing in
 * for the installed tool, and a real HTTP stub standing in for the server —
 * because the two facts CLI-082 exists for are "the write goes through the
 * server" and "a conflicted run writes nothing", and neither is observable
 * from the pure merge (`merge3.test.ts`).
 */

const PREFIX = "corpus-cli082-";
const scratch: string[] = [];

afterEach(async () => {
  await closeStubServers();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${label}-`));
  scratch.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

function read(root: string, relative: string): string {
  return readFileSync(join(root, ...relative.split("/")), "utf8");
}

const SKILL = ".claude/skills/comment/SKILL.md";
const DOC_ID = "doc_skillcomment";

const HEADER =
  "---\n" +
  `id: ${DOC_ID}\n` +
  "type: skill\n" +
  "title: Comment\n" +
  "updated: 2026-07-26T00:00:00Z\n" +
  "---\n";

const BODY_V1 = "\n# Comment\n\nask a question\nthen wait\nsay thanks\n";
const SKILL_V1 = `${HEADER}${BODY_V1}`;

function makeTemplate(): string {
  const root = tempDir("template");
  write(root, "claude/skills/comment/SKILL.md", SKILL_V1);
  write(root, "gitignore", ".corpus/*\n!.corpus/template-manifest.json\n!.corpus/queue/\n");
  write(root, "README.md", "readme v1\nshared line\n");
  return root;
}

async function makeWorkspace(templateRoot: string): Promise<string> {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    port: 9140,
    token: generateToken(),
    toolVersion: "0.1.0",
  });
  await initRepository(root);
  await ensureMaintenanceSettings(root);
  await commitAll({ dir: root, message: "workspace: initialize corpus workspace by user" });
  return root;
}

/** A stub that knows one document and records what is written to it. */
function docResponder(stub: { puts: string[] }, docPath = SKILL) {
  return (
    request: { method: string; path: string; body: string },
    response: Parameters<typeof sendJson>[0],
  ): void => {
    if (request.method === "GET" && request.path === `/api/docs/${DOC_ID}`) {
      sendJson(response, 200, { id: DOC_ID, path: docPath, key: "k1" });
      return;
    }
    if (request.method === "PUT" && request.path === `/api/docs/${DOC_ID}`) {
      stub.puts.push(request.body);
      sendJson(response, 200, { doc: { id: DOC_ID, path: docPath, key: "k2" }, warnings: [] });
      return;
    }
    sendJson(response, 404, { error: { code: "not_found", message: "unknown route" } });
  };
}

interface Harness {
  readonly context: WorkspaceCommandContext;
  stdout(): string;
}

function harnessFor(
  root: string,
  stub: StubServer,
  path: string,
  options: { readonly json?: boolean } = {},
): Harness {
  const workspace = { ...stub.workspace, root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({
    args: { path },
    ...(options.json === undefined ? {} : { json: options.json }),
    version: "0.2.0",
    registry,
  });
  return {
    stdout: () => base.stdout(),
    context: { ...base.context, workspace, client: createClient({ workspace }), actor: "user" },
  };
}

function merge(harness: Harness, template: string): Promise<void> {
  return runWorkspaceMerge(harness.context, { templateRoot: template });
}

/**
 * A real `corpus workspace upgrade` over the same workspace and template — the
 * only honest way to assert that a merge stopped a conflict re-reporting,
 * since "re-reported" is a fact about the *upgrade's* output, not the merge's.
 */
function upgrade(root: string, stub: StubServer, template: string): Promise<Harness> {
  const workspace = { ...stub.workspace, root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({ flags: {}, version: "0.2.0", registry });
  const harness: Harness = {
    stdout: () => base.stdout(),
    context: { ...base.context, workspace, client: createClient({ workspace }), actor: "user" },
  };
  return runWorkspaceUpgrade(harness.context, { templateRoot: template }).then(() => harness);
}

function baselineSha(root: string, path: string): string | undefined {
  return readTemplateManifest(templateManifestPath(root))?.files.find((file) => file.path === path)
    ?.sha256;
}

async function failure(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("corpus workspace merge", () => {
  it("merges divergent copies and writes the result through the server, then advances the baseline", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    // The workspace evolved the skill; the tool's new copy adds its own lines
    // elsewhere; the server restamped `updated:` along the way.
    write(
      root,
      SKILL,
      HEADER.replace("2026-07-26T00:00:00Z", "2026-09-01T10:00:00Z") +
        "\n# Comment\n\nask a question\nlog the answer first\nthen wait\nsay thanks\n",
    );
    const incomingBody = "\n# Comment\n\nask a question\nthen wait\nsay thanks\nand file it\n";
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}${incomingBody}`);

    const harness = harnessFor(root, stub, SKILL);
    await merge(harness, template);

    expect(puts).toHaveLength(1);
    const putBody = JSON.parse(puts[0] as string) as { key: string; body: string };
    expect(putBody.key).toBe("k1");
    expect(putBody.body).toBe(
      "\n# Comment\n\nask a question\nlog the answer first\nthen wait\nsay thanks\nand file it\n",
    );
    expect(harness.stdout()).toContain(`merged ${SKILL}`);
    expect(harness.stdout()).toContain("written through the server as user");

    // The baseline advances to the incoming copy, so the next upgrade does not
    // re-report the conflict this merge resolved.
    const entry = readTemplateManifest(templateManifestPath(root))?.files.find(
      (file) => file.path === SKILL,
    );
    expect(entry?.sha256).toBe(sha256(Buffer.from(`${HEADER}${incomingBody}`, "utf8")));
  });

  it("merges the same file again after a further tool release: the store carries the base", async () => {
    // After the first merge the baseline is the tool's bytes, which no
    // workspace commit holds. When the tool moves again, the second merge's
    // base must come from the baseline store — the first live run of the verb
    // was refused exactly here (E2E, 2026-09-06).
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question\nthen wait\nsay thanks\nlocal\n`);
    const v2Body = "\n# Comment\n\nv2 line\nask a question\nthen wait\nsay thanks\n";
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}${v2Body}`);
    await merge(harnessFor(root, stub, SKILL), template);
    expect(puts).toHaveLength(1);

    // The server's write lands on disk (the stub cannot), so the workspace
    // copy is what the first merge produced.
    write(
      root,
      SKILL,
      `${HEADER}\n# Comment\n\nv2 line\nask a question\nthen wait\nsay thanks\nlocal\n`,
    );
    const v3Body = "\n# Comment\n\nv2 line\nv3 line\nask a question\nthen wait\nsay thanks\n";
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}${v3Body}`);

    const harness = harnessFor(root, stub, SKILL);
    await merge(harness, template);
    expect(puts).toHaveLength(2);
    const putBody = JSON.parse(puts[1] as string) as { body: string };
    expect(putBody.body).toBe(
      "\n# Comment\n\nv2 line\nv3 line\nask a question\nthen wait\nsay thanks\nlocal\n",
    );
  });

  /**
   * The workspace made the tool's change already, and one more of its own:
   * the merge is clean and lands byte-for-byte on the workspace's copy. There
   * is nothing to write, but there is something to *record* — and until the
   * PR #75 review this refused (exit 7) and recorded nothing, so
   * `corpus workspace upgrade` re-reported the same conflict forever and no
   * verb in the surface resolved it.
   */
  describe("when the merge lands on the workspace's own copy", () => {
    const AGREED = "\n# Comment\n\nask a question first\nthen wait\nsay thanks\n";
    const OURS = "\n# Comment\n\nask a question first\nthen wait\nsay thanks\nlocal note\n";

    async function stage(): Promise<{
      readonly template: string;
      readonly root: string;
      readonly stub: StubServer;
      readonly puts: string[];
    }> {
      const template = makeTemplate();
      const root = await makeWorkspace(template);
      const puts: string[] = [];
      const stub = await startStubServer(docResponder({ puts }));
      // Ours carries the tool's line *and* a local one; theirs carries only
      // the tool's. Diff3 reads one `agreement` chunk and one `ours` chunk.
      write(root, SKILL, `${HEADER}${OURS}`);
      write(template, "claude/skills/comment/SKILL.md", `${HEADER}${AGREED}`);
      return { template, root, stub, puts };
    }

    it("writes no document, advances the baseline, and exits 0", async () => {
      const { template, root, stub, puts } = await stage();
      const before = read(root, SKILL);

      const harness = harnessFor(root, stub, SKILL);
      await merge(harness, template);

      expect(puts).toHaveLength(0);
      expect(read(root, SKILL)).toBe(before);
      expect(harness.stdout()).toContain("already contains everything corpus 0.2.0 adds");
      expect(harness.stdout()).toContain("The manifest baseline advanced to the tool's copy");
      expect(baselineSha(root, SKILL)).toBe(sha256(Buffer.from(`${HEADER}${AGREED}`, "utf8")));
    });

    it("stops the next upgrade re-reporting the conflict", async () => {
      const { template, root, stub } = await stage();

      const first = await upgrade(root, stub, template);
      expect(first.stdout()).toContain(`keep    ${SKILL}`);

      await merge(harnessFor(root, stub, SKILL), template);

      const second = await upgrade(root, stub, template);
      expect(second.stdout()).not.toContain(`keep    ${SKILL}`);
      expect(second.stdout()).toContain("already up to date.");
      // Still the workspace's own bytes: nothing was written to resolve it.
      expect(read(root, SKILL)).toBe(`${HEADER}${OURS}`);
    });

    it("reports outcome `advanced` under --json", async () => {
      const { template, root, stub } = await stage();
      const harness = harnessFor(root, stub, SKILL, { json: true });
      await merge(harness, template);
      const report = JSON.parse(harness.stdout()) as { outcome: string; local: number };
      expect(report.outcome).toBe("advanced");
      expect(report.local).toBe(1);
    });

    it("keeps the mark, and says so, when the file is kept", async () => {
      const { template, root, stub } = await stage();
      const manifestPath = templateManifestPath(root);
      const manifest = readTemplateManifest(manifestPath);
      writeFileSync(
        manifestPath,
        serializeManifest({
          ...(manifest as NonNullable<typeof manifest>),
          files: (manifest as NonNullable<typeof manifest>).files.map((entry) =>
            entry.path === SKILL ? { ...entry, kept: true as const } : entry,
          ),
        }),
        "utf8",
      );

      const harness = harnessFor(root, stub, SKILL);
      await merge(harness, template);
      expect(harness.stdout()).toContain("still kept:");
      expect(readTemplateManifest(manifestPath)?.files.find((f) => f.path === SKILL)?.kept).toBe(
        true,
      );
    });
  });

  it("still refuses, and records nothing, when there is genuinely nothing to merge", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    // keep-silent: edited here, and the tool's copy has not moved. There is no
    // incoming change to record, so the baseline must stay exactly where it is
    // — advancing here would silently retire an unreviewed divergence.
    write(root, SKILL, `${SKILL_V1}local\n`);
    const before = baselineSha(root, SKILL);

    const error = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(error) && error.exitCode).toBe(ExitCode.refused);
    expect(isCliError(error) && error.code).toBe("nothing_to_merge");
    expect(baselineSha(root, SKILL)).toBe(before);
  });

  it("writes nothing at all when hunks conflict: byte-identical file, no PUT, exit 6", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question\nthen wait LOCALLY\nsay thanks\n`);
    write(
      template,
      "claude/skills/comment/SKILL.md",
      `${HEADER}\n# Comment\n\nask a question\nthen wait UPSTREAM\nsay thanks\n`,
    );
    const before = read(root, SKILL);

    const harness = harnessFor(root, stub, SKILL);
    const error = await failure(merge(harness, template));

    expect(isCliError(error) && error.exitCode).toBe(ExitCode.checkFailed);
    expect(isCliError(error) && error.message).toContain("nothing was written");
    expect(read(root, SKILL)).toBe(before);
    expect(puts).toHaveLength(0);

    // The hunk prints with all three sides and surrounding context.
    const out = harness.stdout();
    expect(out).toContain("<<<<<<< workspace (your copy)");
    expect(out).toContain("then wait LOCALLY");
    expect(out).toContain("||||||| baseline (what the manifest recorded)");
    expect(out).toContain("then wait");
    expect(out).toContain("=======");
    expect(out).toContain("then wait UPSTREAM");
    expect(out).toContain(">>>>>>> tool (corpus 0.2.0)");
    expect(out).toContain("ask a question");
  });

  it("names the baseline-only-hunk trap on the hunk, and drops nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    // The workspace edited one line (so there is a merge to run at all), and
    // left the `say thanks` block exactly as the baseline has it; the tool's
    // copy lacks that block. Upstream deletion, or a pre-baseline local edit?
    // Undecidable.
    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question politely\nthen wait\nsay thanks\n`);
    write(
      template,
      "claude/skills/comment/SKILL.md",
      `${HEADER}\n# Comment\n\nask a question\nthen wait\n`,
    );
    const before = read(root, SKILL);

    const harness = harnessFor(root, stub, SKILL);
    const error = await failure(merge(harness, template));

    expect(isCliError(error) && error.exitCode).toBe(ExitCode.checkFailed);
    const out = harness.stdout();
    expect(out).toContain("undecidable at");
    expect(out).toContain("either an upstream deletion or a local edit older than the recorded");
    expect(out).toContain("say thanks");
    expect(read(root, SKILL)).toBe(before);
    expect(puts).toHaveLength(0);
  });

  it("says there is nothing to merge for a file identical to the incoming copy", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    const error = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(error) && error.exitCode).toBe(ExitCode.refused);
    expect(isCliError(error) && error.code).toBe("nothing_to_merge");
    expect(isCliError(error) && error.message).toContain("nothing to merge");
  });

  it("points an untouched file at the upgrade instead of merging it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}\nnew body\n`);

    const error = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(error) && error.code).toBe("nothing_to_merge");
    expect(isCliError(error) && error.message).toContain("corpus workspace upgrade");
  });

  it("refuses, rather than guesses, a baseline whose bytes no history holds", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    // A recorded hash no blob matches: the entry is rewritten to a sha of
    // bytes that never existed in this workspace.
    const manifest = readTemplateManifest(templateManifestPath(root));
    if (manifest === undefined) throw new Error("scaffold wrote no manifest");
    writeFileSync(
      templateManifestPath(root),
      serializeManifest({
        ...manifest,
        files: manifest.files.map((entry) =>
          entry.path === SKILL
            ? { ...entry, sha256: sha256(Buffer.from("bytes nobody wrote\n", "utf8")) }
            : entry,
        ),
      }),
      "utf8",
    );
    write(root, SKILL, `${HEADER}\nlocal body\n`);
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}\nupstream body\n`);
    const before = read(root, SKILL);

    const error = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(error) && error.exitCode).toBe(ExitCode.refused);
    expect(isCliError(error) && error.code).toBe("merge_baseline_unavailable");
    expect(isCliError(error) && error.message).toContain("not recoverable");
    expect(read(root, SKILL)).toBe(before);
  });

  it("refuses to write a template file that is not a document", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    // A clean merge on README.md — but it has no frontmatter id, and the
    // server is the sole writer, so this verb will not write it directly.
    write(root, "README.md", "readme v1\nshared line\nlocal line\n");
    write(template, "README.md", "readme v2\nshared line\n");

    const error = await failure(merge(harnessFor(root, stub, "README.md"), template));
    expect(isCliError(error) && error.exitCode).toBe(ExitCode.refused);
    expect(isCliError(error) && error.code).toBe("merge_not_a_document");
    expect(read(root, "README.md")).toBe("readme v1\nshared line\nlocal line\n");
  });

  it("merges a kept file on request and leaves the keep-mark standing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    const manifest = readTemplateManifest(templateManifestPath(root));
    if (manifest === undefined) throw new Error("scaffold wrote no manifest");
    writeFileSync(
      templateManifestPath(root),
      serializeManifest({
        ...manifest,
        files: manifest.files.map((entry) =>
          entry.path === SKILL ? { ...entry, kept: true } : entry,
        ),
      }),
      "utf8",
    );

    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question\nthen wait\nsay thanks\nlocal\n`);
    const incomingBody = "\nupstream\n# Comment\n\nask a question\nthen wait\nsay thanks\n";
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}${incomingBody}`);

    const harness = harnessFor(root, stub, SKILL);
    await merge(harness, template);

    expect(puts).toHaveLength(1);
    expect(harness.stdout()).toContain("still kept");
    const entry = readTemplateManifest(templateManifestPath(root))?.files.find(
      (file) => file.path === SKILL,
    );
    expect(entry?.kept).toBe(true);
    expect(entry?.sha256).toBe(sha256(Buffer.from(`${HEADER}${incomingBody}`, "utf8")));
  });

  it("reports a tool-side frontmatter change instead of merging or dropping it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    write(root, SKILL, `${HEADER}\nlocal body\n`);
    write(
      template,
      "claude/skills/comment/SKILL.md",
      `${HEADER.replace("title: Comment", "title: Comment, renamed")}\nupstream body\n`,
    );
    const before = read(root, SKILL);

    const harness = harnessFor(root, stub, SKILL);
    const error = await failure(merge(harness, template));

    expect(isCliError(error) && error.exitCode).toBe(ExitCode.checkFailed);
    expect(harness.stdout()).toContain("frontmatter");
    expect(harness.stdout()).toContain("title: Comment, renamed");
    expect(read(root, SKILL)).toBe(before);
    expect(puts).toHaveLength(0);
  });

  it("does not count a restamped `updated:` as a frontmatter change", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }));

    // The only frontmatter delta is the server's own stamp; the bodies
    // diverge cleanly. This must merge, not report frontmatter work.
    write(
      root,
      SKILL,
      HEADER.replace("2026-07-26T00:00:00Z", "2026-09-05T09:00:00Z") + `${BODY_V1}local\n`,
    );
    write(template, "claude/skills/comment/SKILL.md", `${HEADER}\nupstream\n${BODY_V1.slice(1)}`);

    const harness = harnessFor(root, stub, SKILL);
    await merge(harness, template);
    expect(puts).toHaveLength(1);
  });

  it("refuses when the file's id names a document the server holds elsewhere", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const puts: string[] = [];
    const stub = await startStubServer(docResponder({ puts }, "data/docs/other.md"));

    // A merge that would be clean — the refusal has to come from the id
    // check, not from a conflict upstream of it.
    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question\nthen wait patiently\nsay thanks\n`);
    write(template, "claude/skills/comment/SKILL.md", `${SKILL_V1}upstream line\n`);

    const error = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(error) && error.code).toBe("merge_wrong_document");
    expect(puts).toHaveLength(0);
  });

  it("says which harmless case a non-conflict is, for every verdict", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    // keep-silent: edited here, unchanged upstream.
    write(root, SKILL, `${SKILL_V1}local\n`);
    const silent = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(silent) && silent.code).toBe("nothing_to_merge");
    expect(isCliError(silent) && silent.message).toContain("has not moved");

    // restore-candidate: deleted here.
    rmSync(join(root, ...SKILL.split("/")));
    const deleted = await failure(merge(harnessFor(root, stub, SKILL), template));
    expect(isCliError(deleted) && deleted.message).toContain("--restore");

    // install: new to the template, absent here.
    write(template, "claude/skills/fresh/SKILL.md", "fresh v1\n");
    const fresh = await failure(
      merge(harnessFor(root, stub, ".claude/skills/fresh/SKILL.md"), template),
    );
    expect(isCliError(fresh) && fresh.message).toContain("installs it");

    // retired: in the manifest, gone from the template.
    rmSync(join(template, "README.md"));
    const retired = await failure(merge(harnessFor(root, stub, "README.md"), template));
    expect(isCliError(retired) && retired.message).toContain("no longer shipped");

    // A modified copy with no manifest entry: mergeless, because three-way
    // needs a base and the manifest never recorded one.
    write(root, ".claude/skills/fresh/SKILL.md", "fresh, but edited\n");
    const baseless = await failure(
      merge(harnessFor(root, stub, ".claude/skills/fresh/SKILL.md"), template),
    );
    expect(isCliError(baseless) && baseless.code).toBe("merge_baseline_unavailable");
    expect(isCliError(baseless) && baseless.message).toContain("no manifest baseline");
  });

  it("refuses an unknown path with the reason, at the usage exit code", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    const error = await failure(merge(harnessFor(root, stub, "data/docs/mine.md"), template));
    expect(isCliError(error) && error.exitCode).toBe(ExitCode.usageError);
    expect(isCliError(error) && error.message).toContain("data/docs/mine.md");
  });

  it("emits the unresolved report as one JSON value before the failure", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const stub = await startStubServer(docResponder({ puts: [] }));

    write(root, SKILL, `${HEADER}\n# Comment\n\nask a question\nthen wait HERE\nsay thanks\n`);
    write(
      template,
      "claude/skills/comment/SKILL.md",
      `${HEADER}\n# Comment\n\nask a question\nthen wait THERE\nsay thanks\n`,
    );

    const harness = harnessFor(root, stub, SKILL, { json: true });
    await failure(merge(harness, template));
    const report = JSON.parse(harness.stdout()) as {
      outcome: string;
      conflicts: readonly { line: number; workspace: string; tool: string }[];
    };
    expect(report.outcome).toBe("unresolved");
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.workspace).toContain("then wait HERE");
    expect(report.conflicts[0]?.tool).toContain("then wait THERE");
    // File-relative, not body-relative: the 6 frontmatter lines count, so the
    // number lands on the line an editor would open (`then wait HERE` is body
    // line 5 under a 6-line header).
    expect(report.conflicts[0]?.line).toBe(11);
  });
});
