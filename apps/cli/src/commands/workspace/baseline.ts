import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../workspace.js";
import { sha256, type TemplateManifest } from "../../template/manifest.js";
import { workspaceFilePath } from "../../template/incoming.js";
import { runGit, type GitRunner } from "../init/git.js";

/**
 * Recovering the **bytes** behind a manifest baseline (CLI-082).
 *
 * The manifest records the baseline's sha256 and nothing else, and the
 * installed tool ships only its *current* template — no older version exists
 * anywhere in the package (`workspace diff` documents the same fact: "the
 * baseline is an identity, not bytes"). A three-way merge, unlike a compare,
 * needs the actual base text. Two honest sources exist:
 *
 * 1. **The workspace's own git history.** `corpus init` commits what it
 *    installs, and every upgrade commits what it writes while recording those
 *    written bytes' sha — so an installed baseline is, in the ordinary case, a
 *    blob in the workspace's repository.
 * 2. **The baseline store**, `.corpus/template-baselines/` — written whenever
 *    a baseline **advances past the workspace's history**: a kept file's entry
 *    following the template (CLI-081), or a merged file's entry advancing to
 *    the incoming copy. Those bytes are the tool's, never committed into the
 *    workspace, so without the store the very next merge of the same file
 *    would be unrecoverable — the first live run of the verb hit exactly that.
 *    The store is content-addressed by the recorded sha, so it is
 *    self-verifying, and it is a cache: losing it degrades to the refusal,
 *    never to a wrong base.
 *
 * The recovery is verification, never guesswork: every candidate is hashed,
 * and only an **exact sha256 match** with the manifest's record is accepted.
 * Where nothing matches — a baseline recorded by `--adopt` from bytes nobody
 * committed, a rewritten history — the answer is `null`, and the caller
 * refuses rather than merging against an invented base (sprint-024 P4: never
 * guess a baseline).
 */
export async function recoverBaselineBytes(
  root: string,
  path: string,
  baselineSha: string,
  git: GitRunner = runGit,
): Promise<Buffer | null> {
  // The cheap candidates first: the file as it stands, which is the baseline
  // exactly when the workspace never touched it — then the store.
  const absolute = workspaceFilePath(root, path);
  if (existsSync(absolute)) {
    const onDisk = readFileSync(absolute);
    if (sha256(onDisk) === baselineSha) return onDisk;
  }

  const stored = readStoredBaseline(root, baselineSha);
  if (stored !== null) return stored;

  const { stdout } = await git(["rev-list", "--all", "--objects", "--", path], root);
  const suffix = ` ${path}`;
  const oids = [
    ...new Set(
      stdout
        .split("\n")
        .filter((line) => line.endsWith(suffix))
        .map((line) => line.slice(0, line.indexOf(" "))),
    ),
  ];

  for (const oid of oids) {
    const { stdout: contents } = await git(["cat-file", "blob", oid], root);
    const bytes = Buffer.from(contents, "utf8");
    if (sha256(bytes) === baselineSha) return bytes;
  }
  return null;
}

/** Workspace-relative directory of the baseline store. */
export const BASELINE_STORE_DIR = `${CONFIG_DIR}/template-baselines`;

function storeDir(root: string): string {
  return join(root, CONFIG_DIR, "template-baselines");
}

/** A well-formed store entry name: exactly the sha256 hex it claims to hold. */
const STORE_NAME = /^[0-9a-f]{64}$/;

function readStoredBaseline(root: string, baselineSha: string): Buffer | null {
  const blob = join(storeDir(root), baselineSha);
  if (!existsSync(blob)) return null;
  const bytes = readFileSync(blob);
  // Content-addressed, so a damaged blob simply fails its own name and the
  // recovery falls through to git — never a wrong base.
  return sha256(bytes) === baselineSha ? bytes : null;
}

/**
 * Records the bytes behind a baseline that is about to advance **past the
 * workspace's own history** — the incoming template copy a kept or merged
 * entry now names. Idempotent: the name is the content's own hash.
 */
export function storeBaselineBytes(root: string, bytes: Buffer): void {
  const dir = storeDir(root);
  mkdirSync(dir, { recursive: true });
  const blob = join(dir, sha256(bytes));
  if (!existsSync(blob)) writeFileSync(blob, bytes);
}

/**
 * Drops store blobs no manifest entry names any more, so the store tracks the
 * manifest instead of growing one blob per release forever. Unknown file
 * names are left alone — the store owns only what it wrote.
 */
export function pruneBaselineStore(root: string, manifest: TemplateManifest): void {
  const dir = storeDir(root);
  if (!existsSync(dir)) return;
  const live = new Set(manifest.files.map((entry) => entry.sha256));
  for (const name of readdirSync(dir)) {
    if (STORE_NAME.test(name) && !live.has(name)) rmSync(join(dir, name), { force: true });
  }
}
