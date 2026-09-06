import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, type TemplateManifest } from "../../template/manifest.js";
import { commitAll, initRepository } from "../init/git.js";
import { pruneBaselineStore, recoverBaselineBytes, storeBaselineBytes } from "./baseline.js";

/**
 * Real git repositories throughout: the module's two sources are the
 * workspace's own history and the baseline store beside the manifest, so a
 * test against anything else would prove nothing about either.
 */

const PREFIX = "corpus-cli082-base-";
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), PREFIX));
  scratch.push(root);
  await initRepository(root);
  return root;
}

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

const PATH = ".claude/skills/comment/SKILL.md";
const V1 = "# Comment\n\nask a question\nthen wait\n";
const V2 = "# Comment\n\nask a question\nthen wait\nand log it\n";

describe("recoverBaselineBytes", () => {
  it("recovers a committed baseline the file has since moved past", async () => {
    const root = await makeRepo();
    write(root, PATH, V1);
    await commitAll({ dir: root, message: "install" });
    write(root, PATH, V2);
    await commitAll({ dir: root, message: "evolve" });

    const bytes = await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V1, "utf8")));
    expect(bytes?.toString("utf8")).toBe(V1);
  });

  it("answers from the file itself when it still is the baseline, before any git walk", async () => {
    const root = await makeRepo();
    write(root, PATH, V1);
    // Never committed — on disk is the only place these bytes exist.
    const bytes = await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V1, "utf8")));
    expect(bytes?.toString("utf8")).toBe(V1);
  });

  it("returns null rather than guessing when no blob matches the recorded hash", async () => {
    const root = await makeRepo();
    write(root, PATH, V2);
    await commitAll({ dir: root, message: "only ever v2" });

    const bytes = await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V1, "utf8")));
    expect(bytes).toBeNull();
  });

  it("verifies by exact hash, never by recency: an older version is found among newer ones", async () => {
    const root = await makeRepo();
    write(root, PATH, "v0\n");
    await commitAll({ dir: root, message: "v0" });
    write(root, PATH, V1);
    await commitAll({ dir: root, message: "v1" });
    write(root, PATH, V2);
    await commitAll({ dir: root, message: "v2" });

    const bytes = await recoverBaselineBytes(root, PATH, sha256(Buffer.from("v0\n", "utf8")));
    expect(bytes?.toString("utf8")).toBe("v0\n");
  });

  it("recovers from the baseline store what no commit ever held", async () => {
    // A kept or merged entry advances to the tool's own bytes, which the
    // workspace never commits — the store is the only place they can live.
    const root = await makeRepo();
    write(root, PATH, V2);
    storeBaselineBytes(root, Buffer.from(V1, "utf8"));

    const bytes = await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V1, "utf8")));
    expect(bytes?.toString("utf8")).toBe(V1);
  });

  it("prunes store blobs the manifest no longer names, and keeps the ones it does", async () => {
    const root = await makeRepo();
    storeBaselineBytes(root, Buffer.from(V1, "utf8"));
    storeBaselineBytes(root, Buffer.from(V2, "utf8"));

    const manifest: TemplateManifest = {
      version: 1,
      tool: "0.1.0",
      installedAt: "x",
      files: [{ path: PATH, sha256: sha256(Buffer.from(V2, "utf8")) }],
    };
    pruneBaselineStore(root, manifest);

    expect(await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V1, "utf8")))).toBeNull();
    const kept = await recoverBaselineBytes(root, PATH, sha256(Buffer.from(V2, "utf8")));
    expect(kept?.toString("utf8")).toBe(V2);
  });

  it("never trusts a damaged store blob: the name must be the content's own hash", async () => {
    const root = await makeRepo();
    const claimed = sha256(Buffer.from(V1, "utf8"));
    write(root, `.corpus/template-baselines/${claimed}`, "tampered bytes\n");

    expect(await recoverBaselineBytes(root, PATH, claimed)).toBeNull();
  });
});
