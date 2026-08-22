import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { QueryKey } from "@corpus/contract";
import { afterAll, describe, expect, it } from "vitest";
import { createWriteWorkspace, AUTH, JSON_HEADERS } from "../docs/write-fixture.js";
import type { DocsWorkspace } from "../docs/index.js";
import { createDocumentMutex } from "../docs/index.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import {
  discoverPlugins,
  excludedInProduction,
  mountPluginRoutes,
  pluginsRootCandidates,
  resolvePluginsRoot,
  resolveRoutesModule,
} from "./discover.js";

/** The sprint's scratch prefix (sprint-012): pid-safe, removed at suite end. */
const SCRATCH_PREFIX = join(tmpdir(), "corpus-s012-plugins001-");
const scratch: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(SCRATCH_PREFIX);
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const FIXTURES_ROOT = join(import.meta.dirname, "fixtures");

describe("resolvePluginsRoot", () => {
  it("resolves the monorepo dev layout from the server package root", () => {
    const root = resolvePluginsRoot({}, join(REPO_ROOT, "apps", "server"));
    expect(root).toBe(join(REPO_ROOT, "plugins"));
  });

  it("prefers the packaged layout when it exists", () => {
    const packageRoot = tempDir();
    mkdirSync(join(packageRoot, "plugins"));
    expect(resolvePluginsRoot({}, packageRoot)).toBe(join(packageRoot, "plugins"));
    expect(pluginsRootCandidates(packageRoot)).toHaveLength(2);
  });

  it("honours CORPUS_PLUGINS_DIR over both layouts", () => {
    const explicit = tempDir();
    expect(resolvePluginsRoot({ CORPUS_PLUGINS_DIR: explicit }, tempDir())).toBe(explicit);
  });

  it("returns undefined when no layout exists — no plugins is a normal state", () => {
    const packageRoot = join(tempDir(), "nowhere", "pkg");
    expect(resolvePluginsRoot({}, packageRoot)).toBeUndefined();
  });

  it("agrees with the UI's build-time glob on the dev plugins root", () => {
    // The parity check of sprint-012 Adjudication 12(iv): the UI discovers
    // via a glob relative to its registry module; the server resolves from
    // its package root. Both must land on the same repo-root `plugins/`.
    const registryPath = join(REPO_ROOT, "apps", "ui", "src", "plugins", "registry.ts");
    const source = readFileSync(registryPath, "utf8");
    const globMatch = /import\.meta\.glob\(\[\s*"([^"]+)"/.exec(source);
    expect(globMatch?.[1]).toBeDefined();
    const globTarget = resolve(dirname(registryPath), dirname(dirname(globMatch?.[1] ?? "")));
    expect(globTarget).toBe(resolvePluginsRoot({}, join(REPO_ROOT, "apps", "server")));
  });
});

describe("excludedInProduction", () => {
  it("skips underscore plugins only in production", () => {
    expect(excludedInProduction("_fixture", { NODE_ENV: "production" })).toBe(true);
    expect(excludedInProduction("_fixture", {})).toBe(false);
    expect(excludedInProduction("todos", { NODE_ENV: "production" })).toBe(false);
  });
});

describe("resolveRoutesModule", () => {
  it("prefers compiled dist/server/routes.js, falls back to server/routes.ts", () => {
    const plugin = tempDir();
    expect(resolveRoutesModule(plugin)).toBeNull();
    mkdirSync(join(plugin, "server"), { recursive: true });
    writeFileSync(join(plugin, "server", "routes.ts"), "export default () => null;\n");
    expect(resolveRoutesModule(plugin)).toBe(join(plugin, "server", "routes.ts"));
    mkdirSync(join(plugin, "dist", "server"), { recursive: true });
    writeFileSync(join(plugin, "dist", "server", "routes.js"), "export default () => null;\n");
    expect(resolveRoutesModule(plugin)).toBe(join(plugin, "dist", "server", "routes.js"));
  });
});

describe("discoverPlugins", () => {
  it("returns empty for a missing or empty root", async () => {
    expect(
      await discoverPlugins({ pluginsRoot: undefined, env: {}, logger: silentLogger }),
    ).toEqual([]);
    expect(
      await discoverPlugins({
        pluginsRoot: join(tempDir(), "gone"),
        env: {},
        logger: silentLogger,
      }),
    ).toEqual([]);
    expect(
      await discoverPlugins({ pluginsRoot: tempDir(), env: {}, logger: silentLogger }),
    ).toEqual([]);
  });

  it("a plugin with no server/ directory is silent — routes null, zero warnings", async () => {
    const root = tempDir();
    mkdirSync(join(root, "quiet", "skills"), { recursive: true });
    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.dir).toBe("quiet");
    expect(plugin?.routes).toBeNull();
    expect(plugin?.warnings).toEqual([]);
  });

  it("loads a compiled dist/server/routes.js module", async () => {
    const root = tempDir();
    mkdirSync(join(root, "compiled", "dist", "server"), { recursive: true });
    writeFileSync(
      join(root, "compiled", "dist", "server", "routes.js"),
      "export default function routes() { return { fetch() {} }; }\n",
    );
    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(typeof plugin?.routes).toBe("function");
  });

  it("skips a throwing routes module with a warning and keeps discovering", async () => {
    const plugins = await discoverPlugins({
      pluginsRoot: FIXTURES_ROOT,
      env: {},
      logger: silentLogger,
    });
    const broken = plugins.find((plugin) => plugin.dir === "broken");
    const shadow = plugins.find((plugin) => plugin.dir === "shadow");
    expect(broken?.routes).toBeNull();
    expect(broken?.warnings.some((warning) => warning.includes("failed to load"))).toBe(true);
    expect(typeof shadow?.routes).toBe("function");
  });

  it("warns when a manifest.ts exists with no types.yaml", async () => {
    const root = tempDir();
    mkdirSync(join(root, "halfdeclared"));
    writeFileSync(join(root, "halfdeclared", "manifest.ts"), "export default {};\n");
    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.warnings.some((warning) => warning.includes("no types.yaml"))).toBe(true);
  });

  it("reads types.yaml and warns on a malformed one", async () => {
    const root = tempDir();
    mkdirSync(join(root, "typed"));
    writeFileSync(join(root, "typed", "types.yaml"), "types:\n  - type: todo\n    label: Todo\n");
    mkdirSync(join(root, "mistyped"));
    writeFileSync(join(root, "mistyped", "types.yaml"), "types: nope\n");
    const plugins = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugins.find((plugin) => plugin.dir === "typed")?.types).toEqual([
      { type: "todo", label: "Todo" },
    ]);
    expect(
      plugins
        .find((plugin) => plugin.dir === "mistyped")
        ?.warnings.some((warning) => warning.includes("types.yaml")),
    ).toBe(true);
  });

  it("reads `derivedStatus: true` and loads the type's server/derive module", async () => {
    const root = tempDir();
    mkdirSync(join(root, "derived", "server"), { recursive: true });
    writeFileSync(
      join(root, "derived", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n",
    );
    writeFileSync(
      join(root, "derived", "server", "derive.ts"),
      "export default (input) => (input.body.includes('- [ ]') ? 'open' : 'resolved');\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.types).toEqual([{ type: "todo", label: "Todo", derivedStatus: true }]);
    expect(typeof plugin?.deriveStatus).toBe("function");
    expect(plugin?.warnings).toEqual([]);
    expect(plugin?.deriveStatus?.({ type: "todo", status: "open", body: "- [x] a\n" })).toBe(
      "resolved",
    );
  });

  it("loads no derive module for a plugin that declares no derived type", async () => {
    const root = tempDir();
    mkdirSync(join(root, "plain", "server"), { recursive: true });
    writeFileSync(join(root, "plain", "types.yaml"), "types:\n  - type: todo\n    label: Todo\n");
    writeFileSync(
      join(root, "plain", "server", "derive.ts"),
      "throw new Error('nobody should import me');\n",
    );

    // Not imported at all: a module nothing will ask anything of must not be
    // able to fail a boot, and its import is latency spent on nothing.
    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(plugin?.warnings).toEqual([]);
  });

  it("warns when a declared derived type ships no server/derive module", async () => {
    const root = tempDir();
    mkdirSync(join(root, "halfseam"));
    writeFileSync(
      join(root, "halfseam", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(plugin?.warnings.some((warning) => warning.includes("no server/derive module"))).toBe(
      true,
    );
  });

  it("contains a derive module that throws at import, and keeps the plugin's routes", async () => {
    const root = tempDir();
    mkdirSync(join(root, "brokenderive", "server"), { recursive: true });
    writeFileSync(
      join(root, "brokenderive", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n",
    );
    writeFileSync(join(root, "brokenderive", "server", "derive.ts"), "throw new Error('boom');\n");
    writeFileSync(
      join(root, "brokenderive", "server", "routes.ts"),
      "export default function routes() { return { fetch() {} }; }\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(typeof plugin?.routes).toBe("function");
    expect(
      plugin?.warnings.some((warning) => warning.includes("server/derive module failed to load")),
    ).toBe(true);
  });

  it("warns when the derive module default-exports something that is not a function", async () => {
    const root = tempDir();
    mkdirSync(join(root, "notafunction", "server"), { recursive: true });
    writeFileSync(
      join(root, "notafunction", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n",
    );
    writeFileSync(
      join(root, "notafunction", "server", "derive.ts"),
      "export default 'resolved';\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(
      plugin?.warnings.some((warning) =>
        warning.includes("server/derive module has no default-exported function"),
      ),
    ).toBe(true);
  });

  it("reads `derivedDue: true` and loads the same module's named `deriveDue` export", async () => {
    // SERVER-134: one module, one export per field, one import. The default
    // export answers `status` because that is the field the seam shipped with;
    // every field after it is named.
    const root = tempDir();
    mkdirSync(join(root, "twofields", "server"), { recursive: true });
    writeFileSync(
      join(root, "twofields", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n    derivedDue: true\n",
    );
    writeFileSync(
      join(root, "twofields", "server", "derive.ts"),
      [
        "globalThis.__corpusDeriveImports = (globalThis.__corpusDeriveImports ?? 0) + 1;",
        "export const deriveDue = (input) => ({ due: input.body.trim() === '' ? null : '2026-07-09' });",
        "export default (input) => (input.body.includes('- [ ]') ? 'open' : 'resolved');",
        "",
      ].join("\n"),
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.types).toEqual([
      { type: "todo", label: "Todo", derivedStatus: true, derivedDue: true },
    ]);
    expect(typeof plugin?.deriveStatus).toBe("function");
    expect(typeof plugin?.deriveDue).toBe("function");
    expect(plugin?.warnings).toEqual([]);
    expect(plugin?.deriveDue?.({ type: "todo", status: "open", body: "- [ ] a\n" })).toEqual({
      due: "2026-07-09",
    });
    // Imported once for both fields: a plugin's top-level code runs on import,
    // and running it twice for one directory is a side effect nobody asked for.
    expect((globalThis as { __corpusDeriveImports?: number }).__corpusDeriveImports).toBe(1);
  });

  it("loads `due` alone for a plugin that declares only that field", async () => {
    const root = tempDir();
    mkdirSync(join(root, "dueonly", "server"), { recursive: true });
    writeFileSync(
      join(root, "dueonly", "types.yaml"),
      "types:\n  - type: deadline\n    label: Deadline\n    derivedDue: true\n",
    );
    writeFileSync(
      join(root, "dueonly", "server", "derive.ts"),
      "export const deriveDue = () => ({ due: null });\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(typeof plugin?.deriveDue).toBe("function");
    // No default export, and no complaint about one: this plugin never claimed a
    // derived status, so nothing looked for the export that answers it.
    expect(plugin?.warnings).toEqual([]);
  });

  it("warns per field when the module is missing the export that field needs", async () => {
    const root = tempDir();
    mkdirSync(join(root, "halfexport", "server"), { recursive: true });
    writeFileSync(
      join(root, "halfexport", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n    derivedDue: true\n",
    );
    writeFileSync(
      join(root, "halfexport", "server", "derive.ts"),
      "export default () => 'resolved';\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    // The field it shipped still works; the field it forgot is named, and costs
    // nothing else.
    expect(typeof plugin?.deriveStatus).toBe("function");
    expect(plugin?.deriveDue).toBeNull();
    expect(
      plugin?.warnings.some((warning) =>
        warning.includes("server/derive module has no `deriveDue` function"),
      ),
    ).toBe(true);
  });

  it("names every field a declared type ships no module for", async () => {
    const root = tempDir();
    mkdirSync(join(root, "nomodule"));
    writeFileSync(
      join(root, "nomodule", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: true\n    derivedDue: true\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.deriveStatus).toBeNull();
    expect(plugin?.deriveDue).toBeNull();
    expect(
      plugin?.warnings.filter((warning) => warning.includes("no server/derive module")),
    ).toEqual([
      "its types.yaml declares a derived status for todo but it ships no server/derive module (SPEC.md §12)",
      "its types.yaml declares a derived due for todo but it ships no server/derive module (SPEC.md §12)",
    ]);
  });

  it("rejects `derivedDue: false` as a spelling, exactly as it rejects it for status", async () => {
    const root = tempDir();
    mkdirSync(join(root, "falseydue"));
    writeFileSync(
      join(root, "falseydue", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedDue: false\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.types).toEqual([]);
    expect(plugin?.warnings.some((warning) => warning.includes("types.yaml"))).toBe(true);
  });

  it("rejects `derivedStatus: false` as a spelling — the key is present or it is not", async () => {
    const root = tempDir();
    mkdirSync(join(root, "falsey"));
    writeFileSync(
      join(root, "falsey", "types.yaml"),
      "types:\n  - type: todo\n    label: Todo\n    derivedStatus: false\n",
    );

    const [plugin] = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(plugin?.types).toEqual([]);
    expect(plugin?.warnings.some((warning) => warning.includes("types.yaml"))).toBe(true);
  });

  it("excludes underscore plugins in production, includes them otherwise", async () => {
    const root = tempDir();
    mkdirSync(join(root, "_fix"));
    mkdirSync(join(root, "real"));
    const dev = await discoverPlugins({ pluginsRoot: root, env: {}, logger: silentLogger });
    expect(dev.map((plugin) => plugin.dir)).toEqual(["_fix", "real"]);
    const prod = await discoverPlugins({
      pluginsRoot: root,
      env: { NODE_ENV: "production" },
      logger: silentLogger,
    });
    expect(prod.map((plugin) => plugin.dir)).toEqual(["real"]);
  });
});

describe("mounted plugin routes, end to end", () => {
  const ws = createWriteWorkspace("plugins", { sprint: "s012" });
  const keys: QueryKey[] = [];
  ws.server.bus.subscribe((emitted) => {
    keys.push(...emitted);
  });

  const workspaceRoot = ws.server.config.workspaceRoot;
  const docsWorkspace: DocsWorkspace = {
    workspaceRoot,
    projection: ws.db,
    git: createAutoCommitter({
      git: createGit(workspaceRoot),
      logger: silentLogger,
      now: () => ws.clock,
    }),
    selfWrites: ws.server.selfWrites,
    bus: ws.server.bus,
    logger: silentLogger,
    now: () => ws.clock,
  };

  afterAll(() => {
    ws.close();
  });

  it("mounts the repo fixture and the test fixtures at /api/x/<dir>", async () => {
    const [repoPlugins, testPlugins] = await Promise.all([
      discoverPlugins({
        pluginsRoot: join(REPO_ROOT, "plugins"),
        env: {},
        logger: silentLogger,
      }),
      discoverPlugins({ pluginsRoot: FIXTURES_ROOT, env: {}, logger: silentLogger }),
    ]);
    mountPluginRoutes(ws.server.app, [...repoPlugins, ...testPlugins], {
      workspace: docsWorkspace,
      mutex: createDocumentMutex(),
      logger: silentLogger,
      now: () => ws.clock,
    });

    const ping = await ws.request("/api/x/shadow/ping", { headers: AUTH });
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ pong: true });
  });

  it("requires the workspace bearer token like any /api route", async () => {
    // Explicit empty headers: the fixture's `request` injects AUTH by default.
    const response = await ws.request("/api/x/shadow/ping", { headers: {} });
    expect(response.status).toBe(401);
  });

  it("cannot shadow a core route — /api/docs stays core", async () => {
    const response = await ws.request("/api/docs", { headers: AUTH });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { items?: unknown; shadowed?: unknown };
    expect(payload.shadowed).toBeUndefined();
    expect(Array.isArray(payload.items)).toBe(true);
    // The would-be shadow landed harmlessly inside the plugin's own prefix.
    const nested = await ws.request("/api/x/shadow/api/docs", { headers: AUTH });
    expect(await nested.json()).toEqual({ shadowed: true });
  });

  it("a plugin write goes through the core write path — commit, projection, SSE", async () => {
    keys.length = 0;
    const response = await ws.request("/api/x/_fixture/notes", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-corpus-author": "agent" },
      body: JSON.stringify({ title: "Plugin-made note" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; title: string };
    expect(created.title).toBe("Plugin-made note");

    // File on disk, committed with agent authorship.
    const authors = ws.log("%an %s");
    expect(authors[0]).toContain("agent");
    expect(authors[0]).toContain("doc create: Plugin-made note");

    // Projection row: the core collection query sees it immediately.
    const listed = await ws.request("/api/docs?type=fixture-note", { headers: AUTH });
    const list = (await listed.json()) as { items: { id: string }[] };
    expect(list.items.map((row) => row.id)).toContain(created.id);

    // The plugin's own key rode the same bus as the core keys, namespaced.
    expect(keys).toContainEqual(["x", "_fixture", "notes"]);
    expect(keys).toContainEqual(["docs"]);

    // And the plugin's own list route serves it.
    const notes = await ws.request("/api/x/_fixture/notes", { headers: AUTH });
    const payload = (await notes.json()) as { notes: { id: string }[] };
    expect(payload.notes.map((note) => note.id)).toContain(created.id);
  });

  it("an unmounted plugin path 404s like any unknown route", async () => {
    const response = await ws.request("/api/x/nonexistent/anything", { headers: AUTH });
    expect(response.status).toBe(404);
  });
});
