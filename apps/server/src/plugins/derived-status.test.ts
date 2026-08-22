import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import {
  createDerivedStatusRegistry,
  EMPTY_DERIVED_STATUS,
  type DerivedStatusDeclaration,
} from "./derived-status.js";

const lines: string[] = [];
const recordingLogger = createLogger("info", {
  write: (line) => {
    lines.push(line);
  },
});

function capture<T>(run: () => T): { value: T; logged: string[] } {
  const start = lines.length;
  const value = run();
  return { value, logged: lines.slice(start) };
}

const todos = (derive: DerivedStatusDeclaration["deriveStatus"]): DerivedStatusDeclaration => ({
  dir: "todos",
  types: [{ type: "todo", derivedStatus: true }],
  deriveStatus: derive,
});

const ask = (
  registry: { derive: (input: { type: string; status: string; body: string }) => unknown },
  status = "open",
  body = "",
  type = "todo",
): unknown => registry.derive({ type, status, body });

describe("the derived-status registry (SPEC.md §12, SERVER-085)", () => {
  it("answers for a type its plugin declares, and for no other", () => {
    const registry = createDerivedStatusRegistry([todos(() => "resolved")], recordingLogger);

    expect(registry.derives("todo")).toBe(true);
    expect(registry.derives("note")).toBe(false);
    expect(registry.types).toEqual(new Set(["todo"]));
    expect(ask(registry)).toBe("resolved");
    expect(ask(registry, "open", "", "note")).toBeNull();
  });

  it("ignores a type the plugin's own types.yaml does not flag", () => {
    const registry = createDerivedStatusRegistry(
      [
        {
          dir: "todos",
          types: [{ type: "todo", derivedStatus: true }, { type: "note" }],
          deriveStatus: () => "resolved",
        },
      ],
      recordingLogger,
    );

    // The ownership refusal by construction: a plugin declaring a type without
    // the flag never reaches its own derivation for that type.
    expect(registry.derives("note")).toBe(false);
    expect(ask(registry, "open", "", "note")).toBeNull();
  });

  it("passes the whole document through: type, stored status, body and extra", () => {
    const seen: unknown[] = [];
    const registry = createDerivedStatusRegistry(
      [
        todos((input) => {
          seen.push(input);
          return null;
        }),
      ],
      recordingLogger,
    );

    registry.derive({
      type: "todo",
      status: "archived",
      body: "- [x] done\n",
      extra: { items: [] },
    });
    expect(seen).toEqual([
      { type: "todo", status: "archived", body: "- [x] done\n", extra: { items: [] } },
    ]);
  });

  it("contains a derivation that throws, and says so once", () => {
    const registry = createDerivedStatusRegistry(
      [
        todos(() => {
          throw new Error("items exploded");
        }),
      ],
      recordingLogger,
    );

    const first = capture(() => ask(registry));
    const second = capture(() => ask(registry));

    expect(first.value).toBeNull();
    expect(second.value).toBeNull();
    expect(first.logged.join("\n")).toContain("its status derivation for todo threw");
    // One line per plugin per fault: a rebuild asks this once per file, and a
    // broken derivation must not write eight hundred identical warnings.
    expect(second.logged).toEqual([]);
  });

  it("contains an out-of-range answer — `archived` included — and says so once", () => {
    for (const answer of ["archived", "", "OPEN", 3, {}]) {
      const registry = createDerivedStatusRegistry([todos(() => answer)], recordingLogger);
      const first = capture(() => ask(registry));
      const second = capture(() => ask(registry));

      expect(first.value).toBeNull();
      expect(second.value).toBeNull();
      expect(first.logged.join("\n")).toContain("which is not open, resolved or null");
      expect(second.logged).toEqual([]);
    }
  });

  it("treats `undefined` as `null`: the stored value stands, with nothing logged", () => {
    const registry = createDerivedStatusRegistry([todos(() => undefined)], recordingLogger);
    const { value, logged } = capture(() => ask(registry));

    expect(value).toBeNull();
    expect(logged).toEqual([]);
  });

  it("leaves a declared type on its stored status when the plugin shipped no module", () => {
    const registry = createDerivedStatusRegistry(
      [{ dir: "todos", types: [{ type: "todo", derivedStatus: true }], deriveStatus: null }],
      recordingLogger,
    );

    expect(registry.derives("todo")).toBe(false);
    expect(registry.types.size).toBe(0);
  });

  it("gives a contested type to the first plugin and logs the loser", () => {
    const { value: registry, logged } = capture(() =>
      createDerivedStatusRegistry(
        [
          { ...todos(() => "resolved"), dir: "a-plugin" },
          { ...todos(() => "open"), dir: "b-plugin" },
        ],
        recordingLogger,
      ),
    );

    expect(ask(registry)).toBe("resolved");
    expect(logged.join("\n")).toContain("already derives its status through plugin a-plugin");
  });

  it("derives nothing at all when no plugin is present", () => {
    expect(EMPTY_DERIVED_STATUS.types.size).toBe(0);
    expect(EMPTY_DERIVED_STATUS.derives("todo")).toBe(false);
    expect(ask(EMPTY_DERIVED_STATUS)).toBeNull();
  });
});
