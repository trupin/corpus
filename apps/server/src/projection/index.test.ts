import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as projection from "./index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-surface-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("projection public surface", () => {
  it("exposes the whole projection from one entry point", () => {
    // Nothing outside `projection/` imports its internal modules, so this list
    // is the contract the write paths, the watcher and the CLI code against.
    for (const name of [
      "openProjection",
      "openProjectionReadonly",
      "attachProjection",
      "projectDocument",
      "removeDocument",
      "populateFromFiles",
      "clearProjection",
      "rebuild",
      "doctor",
      "mountDbRoutes",
      "REBUILD_QUERY_KEYS",
      "projectQueueDir",
      "projectEvent",
      "removeEvent",
      "projectJobsDir",
      "projectJob",
      "removeJob",
      "projectLocksDir",
      "projectLock",
      "removeLock",
      "projectSeen",
      "projectRuntime",
      "enumerateDocuments",
      "classifyPath",
      "DOCUMENT_ROOTS",
      "PROJECTION_TABLES",
      "PROJECTION_DDL",
      "SCHEMA_VERSION",
      "DRIFT_KINDS",
      "ProjectionError",
    ]) {
      expect(projection, `projection should export ${name}`).toHaveProperty(name);
    }
  });

  it("takes a workspace from files to rows and back to a clean bill of health", () => {
    const workspaceRoot = join(root, "ws");
    mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, "data", "docs", "a.md"),
      `---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n`,
      "utf8",
    );
    const config = { workspaceRoot, corpusDir: join(workspaceRoot, ".corpus") };

    expect(projection.rebuild(config).documents).toBe(1);
    expect(projection.doctor(config)).toMatchObject({ ok: true, drift: [] });
  });

  it("keeps every projection function synchronous — read-your-write depends on it", () => {
    for (const name of [
      "openProjection",
      "projectDocument",
      "removeDocument",
      "populateFromFiles",
      "projectRuntime",
      "rebuild",
      "doctor",
    ] as const) {
      const fn: unknown = projection[name];
      expect(typeof fn, name).toBe("function");
      expect((fn as { constructor: { name: string } }).constructor.name, name).toBe("Function");
    }
  });
});
