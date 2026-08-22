import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import {
  createDerivedFieldsRegistry,
  EMPTY_DERIVED_FIELDS,
  type DerivedFieldRegistry,
  type DerivedFieldsDeclaration,
  type PluginDerive,
} from "./derived-fields.js";

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

const todos = (
  fields: { status?: PluginDerive; due?: PluginDerive },
  flags: { derivedStatus?: true; derivedDue?: true } = { derivedStatus: true },
): DerivedFieldsDeclaration => ({
  dir: "todos",
  types: [{ type: "todo", ...flags }],
  deriveStatus: fields.status ?? null,
  deriveDue: fields.due ?? null,
});

const ask = (
  field: DerivedFieldRegistry<unknown>,
  status = "open",
  body = "",
  type = "todo",
): unknown => field.derive({ type, status, body });

describe("the derived-fields registry — the rules every field shares (SPEC.md §12)", () => {
  it("answers for a type its plugin declares, and for no other", () => {
    const registry = createDerivedFieldsRegistry(
      [todos({ status: () => "resolved" })],
      recordingLogger,
    );

    expect(registry.status.derives("todo")).toBe(true);
    expect(registry.status.derives("note")).toBe(false);
    expect(registry.status.types).toEqual(new Set(["todo"]));
    expect(ask(registry.status)).toBe("resolved");
    expect(ask(registry.status, "open", "", "note")).toBeNull();
  });

  it("ignores a type the plugin's own types.yaml does not flag", () => {
    const registry = createDerivedFieldsRegistry(
      [
        {
          dir: "todos",
          types: [{ type: "todo", derivedStatus: true }, { type: "note" }],
          deriveStatus: () => "resolved",
          deriveDue: () => ({ due: "2026-08-04" }),
        },
      ],
      recordingLogger,
    );

    // The ownership refusal by construction: a plugin declaring a type without
    // the flag never reaches its own derivation for that type — per field, so a
    // type deriving one field does not thereby derive the other.
    expect(registry.status.derives("note")).toBe(false);
    expect(ask(registry.status, "open", "", "note")).toBeNull();
    expect(registry.due.derives("todo")).toBe(false);
    expect(ask(registry.due)).toBeNull();
  });

  it("passes the whole document through: type, stored status, body and extra", () => {
    const seen: unknown[] = [];
    const registry = createDerivedFieldsRegistry(
      [
        todos(
          {
            status: (input) => {
              seen.push(input);
              return null;
            },
            due: (input) => {
              seen.push(input);
              return null;
            },
          },
          { derivedStatus: true, derivedDue: true },
        ),
      ],
      recordingLogger,
    );

    const input = { type: "todo", status: "archived", body: "- [x] done\n", extra: { items: [] } };
    registry.status.derive(input);
    registry.due.derive(input);
    expect(seen).toEqual([input, input]);
  });

  it("contains a derivation that throws, per field, and says so once each", () => {
    const boom = (): never => {
      throw new Error("items exploded");
    };
    const registry = createDerivedFieldsRegistry(
      [todos({ status: boom, due: boom }, { derivedStatus: true, derivedDue: true })],
      recordingLogger,
    );

    const first = capture(() => ask(registry.status));
    const second = capture(() => ask(registry.status));
    const due = capture(() => ask(registry.due));

    expect(first.value).toBeNull();
    expect(second.value).toBeNull();
    expect(first.logged.join("\n")).toContain("its status derivation for todo threw");
    // One line per plugin per field per fault: a rebuild asks this once per file,
    // and a broken derivation must not write eight hundred identical warnings.
    expect(second.logged).toEqual([]);
    // …but a broken `due` is still reported after a broken `status`: the two are
    // separate faults of the same plugin, and silencing one with the other would
    // hide a field entirely.
    expect(due.value).toBeNull();
    expect(due.logged.join("\n")).toContain("its due derivation for todo threw");
  });

  it("treats `undefined` as `null`: the stored value stands, with nothing logged", () => {
    const registry = createDerivedFieldsRegistry(
      [todos({ status: () => undefined })],
      recordingLogger,
    );
    const { value, logged } = capture(() => ask(registry.status));

    expect(value).toBeNull();
    expect(logged).toEqual([]);
  });

  it("leaves a declared type on its stored value when the plugin shipped no export", () => {
    const registry = createDerivedFieldsRegistry(
      [
        {
          dir: "todos",
          types: [{ type: "todo", derivedStatus: true, derivedDue: true }],
          deriveStatus: () => "resolved",
          deriveDue: null,
        },
      ],
      recordingLogger,
    );

    // Per field: the module shipped `status` and not `due`, so `status` derives
    // and `due` does not — a half-built plugin costs the field it forgot and
    // nothing else.
    expect(registry.status.derives("todo")).toBe(true);
    expect(registry.due.derives("todo")).toBe(false);
    expect(registry.due.types.size).toBe(0);
    expect(registry.types).toEqual(new Set(["todo"]));
  });

  it("gives a contested type to the first plugin and logs the loser, per field", () => {
    const { value: registry, logged } = capture(() =>
      createDerivedFieldsRegistry(
        [
          {
            ...todos(
              { status: () => "resolved", due: () => ({ due: "2026-08-04" }) },
              {
                derivedStatus: true,
                derivedDue: true,
              },
            ),
            dir: "a-plugin",
          },
          {
            ...todos(
              { status: () => "open", due: () => ({ due: "2027-01-01" }) },
              {
                derivedStatus: true,
                derivedDue: true,
              },
            ),
            dir: "b-plugin",
          },
        ],
        recordingLogger,
      ),
    );

    expect(ask(registry.status)).toBe("resolved");
    expect(ask(registry.due)).toEqual({ due: "2026-08-04" });
    expect(logged.join("\n")).toContain("already derives its status through plugin a-plugin");
    expect(logged.join("\n")).toContain("already derives its due through plugin a-plugin");
  });

  it("derives nothing at all when no plugin is present", () => {
    expect(EMPTY_DERIVED_FIELDS.types.size).toBe(0);
    expect(EMPTY_DERIVED_FIELDS.derives("todo")).toBe(false);
    expect(EMPTY_DERIVED_FIELDS.status.derives("todo")).toBe(false);
    expect(EMPTY_DERIVED_FIELDS.due.derives("todo")).toBe(false);
    expect(ask(EMPTY_DERIVED_FIELDS.status)).toBeNull();
    expect(ask(EMPTY_DERIVED_FIELDS.due)).toBeNull();
  });

  it("says a type derives when any one of its fields does", () => {
    const registry = createDerivedFieldsRegistry(
      [
        {
          dir: "todos",
          types: [
            { type: "todo", derivedStatus: true },
            { type: "deadline", derivedDue: true },
          ],
          deriveStatus: () => "open",
          deriveDue: () => ({ due: null }),
        },
      ],
      recordingLogger,
    );

    // The union is what the write path dismisses on: a document is worth parsing
    // when *something* about it is derived.
    expect(registry.types).toEqual(new Set(["todo", "deadline"]));
    expect(registry.derives("todo")).toBe(true);
    expect(registry.derives("deadline")).toBe(true);
    expect(registry.derives("note")).toBe(false);
    expect(registry.status.derives("deadline")).toBe(false);
    expect(registry.due.derives("todo")).toBe(false);
  });
});

describe("the `status` field's validator", () => {
  it("contains an out-of-range answer — `archived` included — and says so once", () => {
    for (const answer of ["archived", "", "OPEN", 3, {}]) {
      const registry = createDerivedFieldsRegistry(
        [todos({ status: () => answer })],
        recordingLogger,
      );
      const first = capture(() => ask(registry.status));
      const second = capture(() => ask(registry.status));

      expect(first.value).toBeNull();
      expect(second.value).toBeNull();
      expect(first.logged.join("\n")).toContain("which is not open, resolved or null");
      expect(second.logged).toEqual([]);
    }
  });
});

describe("the `due` field's validator — three answers, and no two of them collapse", () => {
  const dueRegistry = (derive: PluginDerive): DerivedFieldsRegistry_ =>
    createDerivedFieldsRegistry([todos({ due: derive }, { derivedDue: true })], recordingLogger);
  type DerivedFieldsRegistry_ = ReturnType<typeof createDerivedFieldsRegistry>;

  it("passes a date through, normalized", () => {
    expect(ask(dueRegistry(() => ({ due: "2026-08-04" })).due)).toEqual({ due: "2026-08-04" });
    // Lenient on read, canonical on write — the same reader the `due` column
    // goes through, so a plugin cannot put a shape in the file that the row
    // would then refuse.
    expect(ask(dueRegistry(() => ({ due: " 2026-08-04 " })).due)).toEqual({ due: "2026-08-04" });
  });

  it("keeps `{ due: null }` distinct from `null`", () => {
    // The middle answer: the derivation applies and this document has no
    // deadline. Collapsing it into the outer `null` is what would leave a
    // completed list overdue forever (PLUGINS-018 decision 2).
    const { value, logged } = capture(() => ask(dueRegistry(() => ({ due: null })).due));
    expect(value).toEqual({ due: null });
    expect(logged).toEqual([]);

    const declined = capture(() => ask(dueRegistry(() => null).due));
    expect(declined.value).toBeNull();
    expect(declined.logged).toEqual([]);
  });

  it("contains anything that is not one of the three, and says so once", () => {
    for (const answer of [
      "2026-08-04",
      { due: "not a date" },
      { due: "2026-02-30" },
      { due: 20260804 },
      { due: undefined },
      {},
      [],
      42,
    ]) {
      const registry = dueRegistry(() => answer);
      const first = capture(() => ask(registry.due));
      const second = capture(() => ask(registry.due));

      expect(first.value, JSON.stringify(answer)).toBeNull();
      expect(second.value).toBeNull();
      expect(first.logged.join("\n")).toContain(
        "which is not an object carrying an ISO calendar date or null",
      );
      expect(second.logged).toEqual([]);
    }
  });
});
