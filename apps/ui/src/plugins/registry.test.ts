import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRegistry,
  DISCOVERY_BUDGET_MS,
  EMPTY_REGISTRY,
  loadPlugins,
  pluginDiscoveryPhase,
  pluginRegistry,
  setPluginRegistry,
} from "./registry";

const component = (): null => null;

function manifestModule(overrides: Record<string, unknown> = {}): { loaded: { module: unknown } } {
  return {
    loaded: {
      module: {
        default: {
          id: "p",
          name: "P",
          docTypes: [],
          columns: [],
          ...overrides,
        },
      },
    },
  };
}

describe("buildRegistry", () => {
  it("an empty module list is an empty registry — no warnings, no error", () => {
    const registry = buildRegistry([]);
    expect(registry.plugins).toEqual([]);
    expect(registry.warnings).toEqual([]);
    expect(registry.docTypes.size).toBe(0);
    expect(registry.columns.size).toBe(0);
  });

  it("indexes doc types and columns, keying columns by directory", () => {
    const registry = buildRegistry([
      {
        dir: "alpha",
        ...manifestModule({
          id: "not-the-dir",
          docTypes: [{ type: "todo", View: component }],
          columns: [{ type: "board", label: "Board", Component: component }],
        }),
      },
    ]);
    expect(registry.docTypes.get("todo")?.plugin.dir).toBe("alpha");
    // Keyed by the DIRECTORY name, never the manifest's self-declared id.
    expect(registry.columns.has("alpha/board")).toBe(true);
    expect(registry.columns.has("not-the-dir/board")).toBe(false);
  });

  it("a throwing module is skipped with a warning; the others load", () => {
    const registry = buildRegistry([
      { dir: "broken", loaded: { error: new Error("boom at module scope") } },
      { dir: "fine", ...manifestModule({ id: "fine" }) },
    ]);
    expect(registry.plugins.map((plugin) => plugin.dir)).toEqual(["fine"]);
    expect(registry.warnings).toHaveLength(1);
    expect(registry.warnings[0]?.plugin).toBe("broken");
    expect(registry.warnings[0]?.reason).toContain("boom at module scope");
  });

  it("an invalid manifest is skipped with a readable warning", () => {
    const registry = buildRegistry([
      { dir: "bad", loaded: { module: { default: { name: "no id", docTypes: [], columns: [] } } } },
    ]);
    expect(registry.plugins).toEqual([]);
    expect(registry.warnings[0]?.reason).toContain("id");
  });

  it("a module with no default export is skipped with a warning", () => {
    const registry = buildRegistry([{ dir: "empty", loaded: { module: {} } }]);
    expect(registry.plugins).toEqual([]);
    expect(registry.warnings[0]?.reason).toContain("default export");
  });

  it("duplicate doc-type claims resolve by order, then name — and record the loser", () => {
    const modules = [
      {
        dir: "zeta",
        ...manifestModule({ id: "zeta", order: 1, docTypes: [{ type: "todo" }] }),
      },
      {
        dir: "alpha",
        ...manifestModule({ id: "alpha", order: 2, docTypes: [{ type: "todo" }] }),
      },
    ];
    const forward = buildRegistry(modules);
    const reversed = buildRegistry([...modules].reverse());
    // `order` decides (1 < 2), regardless of glob enumeration order.
    expect(forward.docTypes.get("todo")?.plugin.dir).toBe("zeta");
    expect(reversed.docTypes.get("todo")?.plugin.dir).toBe("zeta");
    expect(forward.warnings.some((warning) => warning.plugin === "alpha")).toBe(true);
  });

  it("ties on order fall back to directory name, deterministically", () => {
    const modules = [
      { dir: "beta", ...manifestModule({ id: "beta", docTypes: [{ type: "todo" }] }) },
      { dir: "alpha", ...manifestModule({ id: "alpha", docTypes: [{ type: "todo" }] }) },
    ];
    expect(buildRegistry(modules).docTypes.get("todo")?.plugin.dir).toBe("alpha");
    expect(buildRegistry([...modules].reverse()).docTypes.get("todo")?.plugin.dir).toBe("alpha");
  });
});

describe("loadPlugins (real glob)", () => {
  it("discovers the repo's fixture plugin and never throws", async () => {
    const registry = await loadPlugins();
    // The dev tree carries plugins/_fixture; its manifest must load cleanly.
    expect(registry.plugins.some((plugin) => plugin.dir === "_fixture")).toBe(true);
    expect(registry.warnings.filter((warning) => warning.plugin === "_fixture")).toEqual([]);
    expect(pluginRegistry()).toBe(registry);
  });
});

/**
 * The half of the registry a layout consults (UI-073). A surface that paints
 * during discovery is painting a layout about to change under the user's
 * pointer, and `pluginRegistry()` alone cannot tell "nothing registered" from
 * "nothing loaded yet".
 */
describe("the discovery phase", () => {
  afterEach(() => {
    vi.useRealTimers();
    setPluginRegistry(EMPTY_REGISTRY);
  });

  it("is settled before anything asks to discover — the state a test host sees", () => {
    expect(pluginDiscoveryPhase()).toBe("settled");
  });

  it("turns pending synchronously, before loadPlugins' first await", async () => {
    const loading = loadPlugins();
    // Not awaited: `main.tsx` calls `loadPlugins()` and then renders, so the
    // very first render has to already see `pending`.
    expect(pluginDiscoveryPhase()).toBe("pending");
    await loading;
    expect(pluginDiscoveryPhase()).toBe("settled");
  });

  it("abandons the wait after the budget, and settles if it finishes anyway", async () => {
    vi.useFakeTimers();
    const loading = loadPlugins();
    expect(pluginDiscoveryPhase()).toBe("pending");

    // No `await` before this: the imports' microtasks have not run, so the
    // timer fires against a genuinely unfinished discovery.
    vi.advanceTimersByTime(DISCOVERY_BUDGET_MS + 1);
    expect(pluginDiscoveryPhase()).toBe("abandoned");

    // Nothing was cancelled — a late discovery still installs, and the next
    // surface to open resolves against it.
    await loading;
    expect(pluginDiscoveryPhase()).toBe("settled");
    expect(pluginRegistry().plugins.length).toBeGreaterThan(0);
  });

  it("treats a hand-installed registry as settled — there is nothing in flight", () => {
    setPluginRegistry(EMPTY_REGISTRY, "pending");
    expect(pluginDiscoveryPhase()).toBe("pending");
    setPluginRegistry(EMPTY_REGISTRY);
    expect(pluginDiscoveryPhase()).toBe("settled");
  });
});

describe("EMPTY_REGISTRY", () => {
  it("is the app-behaves-as-if-no-plugin-system state", () => {
    expect(EMPTY_REGISTRY.plugins).toEqual([]);
    expect(EMPTY_REGISTRY.docTypes.size).toBe(0);
  });
});
