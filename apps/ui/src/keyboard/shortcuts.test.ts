/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  chordDirection,
  chordProbes,
  matchesShortcut,
  SHORTCUTS,
  shortcutProbes,
  type Shortcut,
} from "./shortcuts";

const event = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", init);

describe("the shortcut registry", () => {
  it("declares unique ids", () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a non-empty description and group", () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.description.trim(), shortcut.id).not.toBe("");
      expect(shortcut.group.trim(), shortcut.id).not.toBe("");
    }
  });

  /**
   * The integrity check the registry exists for: two entries answering the same
   * press in the same scope is an ambiguity no cheat-sheet could describe, and
   * the probes are generated from the chords rather than listed by hand, so a
   * binding added tomorrow is checked without anyone remembering to check it.
   */
  it("has no two entries matching the same key in the same scope", () => {
    for (const { shortcut, probe } of shortcutProbes()) {
      const press = event(probe);
      const rivals = SHORTCUTS.filter(
        (other) =>
          other.id !== shortcut.id &&
          (other.scope === shortcut.scope ||
            other.scope === "global" ||
            shortcut.scope === "global") &&
          matchesShortcut(other, press),
      );
      expect(
        rivals.map((rival) => rival.id),
        `${shortcut.id} ← ${probe.key ?? ""}`,
      ).toEqual([]);
    }
  });

  it("matches every key it declares, and no modified form it does not", () => {
    for (const { shortcut, probe } of shortcutProbes()) {
      expect(matchesShortcut(shortcut, event(probe)), shortcut.id).toBe(true);
      expect(matchesShortcut(shortcut, event({ ...probe, altKey: true })), shortcut.id).toBe(false);
    }
  });

  it("distinguishes ↵ from ⇧↵ and ← from ⇧←", () => {
    const open = byId("rows.open");
    const full = byId("rows.openFullScreen");
    expect(matchesShortcut(open, event({ key: "Enter" }))).toBe(true);
    expect(matchesShortcut(open, event({ key: "Enter", shiftKey: true }))).toBe(false);
    expect(matchesShortcut(full, event({ key: "Enter", shiftKey: true }))).toBe(true);
    expect(matchesShortcut(full, event({ key: "Enter" }))).toBe(false);

    expect(matchesShortcut(byId("columns.switch"), event({ key: "ArrowLeft" }))).toBe(true);
    expect(
      matchesShortcut(byId("columns.switch"), event({ key: "ArrowLeft", shiftKey: true })),
    ).toBe(false);
    expect(matchesShortcut(byId("columns.move"), event({ key: "ArrowLeft", shiftKey: true }))).toBe(
      true,
    );
  });

  it("accepts ⌘K and Ctrl+K, and only with a modifier", () => {
    const search = byId("search.open");
    expect(matchesShortcut(search, event({ key: "k", metaKey: true }))).toBe(true);
    expect(matchesShortcut(search, event({ key: "K", ctrlKey: true }))).toBe(true);
    expect(matchesShortcut(search, event({ key: "k" }))).toBe(false);
  });

  it("reads `?` however the layout shifts it", () => {
    expect(matchesShortcut(byId("cheatSheet.toggle"), event({ key: "?", shiftKey: true }))).toBe(
      true,
    );
    expect(matchesShortcut(byId("cheatSheet.toggle"), event({ key: "?" }))).toBe(true);
  });

  it("leaves esc/⌫ to the escape layer rather than binding a second chain", () => {
    const close = byId("layers.close");
    expect(close.boundBy).toBe("escape-layer");
    expect(close.run).toBeUndefined();
    expect(close.chords.flatMap((chord) => chord.keys)).toEqual(["Escape", "Backspace"]);
  });

  it("derives direction from the key of a paired chord", () => {
    expect(chordDirection(event({ key: "ArrowUp" }))).toBe(-1);
    expect(chordDirection(event({ key: "k" }))).toBe(-1);
    expect(chordDirection(event({ key: "[" }))).toBe(-1);
    expect(chordDirection(event({ key: "ArrowLeft" }))).toBe(-1);
    expect(chordDirection(event({ key: "ArrowDown" }))).toBe(1);
    expect(chordDirection(event({ key: "j" }))).toBe(1);
    expect(chordDirection(event({ key: "]" }))).toBe(1);
  });

  it("generates one probe per accepted key of a chord", () => {
    expect(chordProbes({ keys: ["k", "K"], mod: true })).toEqual([
      { key: "k", shiftKey: false, metaKey: true },
      { key: "K", shiftKey: false, metaKey: true },
    ]);
  });

  /**
   * SPEC.md §10's enumeration and `design/index.html`'s twelve rows, item by
   * item. A binding present in one and absent from the other is a scheme that
   * has quietly changed without the spec saying so.
   */
  it("is exactly SPEC.md §10's scheme, in the prototype's order", () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.id)).toEqual([
      "rows.move",
      "rows.open",
      "rows.openFullScreen",
      "menu.open",
      "layers.close",
      "columns.switch",
      "columns.move",
      "doc.focusMode",
      "doc.archive",
      "doc.reply",
      "compose.open",
      "search.open",
      "cheatSheet.toggle",
    ]);
    expect(SHORTCUTS.map((shortcut) => shortcut.description)).toEqual([
      "move rows (also j / k)",
      "open document",
      "open in full screen",
      "actions for the highlighted row",
      "close / back",
      "switch column (also [ / ])",
      "move column",
      "focus mode",
      "archive open / highlighted doc",
      "reply in open thread",
      "Ask / Capture composer",
      "search",
      "this cheat-sheet",
    ]);
  });

  /**
   * UI-032's guard, and the reason the rule is declared in the registry rather
   * than written into the dispatcher: a binding is checked because it exists,
   * not because someone remembered to check it. Every `↵` on the board is a key
   * a focused control presses itself with, so every one of them must yield —
   * an entry that forgets re-opens the defect for every button in the app.
   */
  it("makes every board ↵ yield to a focused control", () => {
    const enter = SHORTCUTS.filter(
      (shortcut) =>
        shortcut.scope === "board" && shortcut.chords.some((chord) => chord.keys.includes("Enter")),
    );
    expect(enter.map((shortcut) => shortcut.id)).toEqual(["rows.open", "rows.openFullScreen"]);
    for (const shortcut of enter) {
      expect(shortcut.yieldsToFocusedControl, shortcut.id).toBe(true);
    }
  });

  /**
   * The other half of a control's activation contract. `Space` works on every
   * trigger in the app **because nothing here claims it** — that is what UI-030
   * and UI-041 fell back on while `↵` was being stolen. Binding it would take
   * the second key away too, silently.
   */
  it("leaves Space unbound", () => {
    const claimed = SHORTCUTS.filter((shortcut) =>
      shortcut.chords.some((chord) => chord.keys.includes(" ") || chord.keys.includes("Spacebar")),
    );
    expect(claimed.map((shortcut) => shortcut.id)).toEqual([]);
  });

  it("only ⌘K survives a writing surface", () => {
    const permitted = SHORTCUTS.filter((shortcut) => shortcut.allowInInput === true);
    expect(permitted.map((shortcut) => shortcut.id)).toEqual(["search.open"]);
  });
});

function byId(id: string): Shortcut {
  const found = SHORTCUTS.find((shortcut) => shortcut.id === id);
  if (found === undefined) throw new Error(`no shortcut ${id}`);
  return found;
}
