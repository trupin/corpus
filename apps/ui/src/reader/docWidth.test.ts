/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage.js";
import {
  DOC_WIDTH_STATE_VERSION,
  DOC_WIDTH_STORAGE_KEY,
  EMPTY_DOC_WIDTH_STATE,
  MAX_DOC_WIDTH,
  MIN_DOC_WIDTH,
  clampDocWidth,
  clearDocWidthState,
  readDocWidthState,
  writeDocWidthState,
} from "./docWidth";
import { FOCUS_SURFACE, columnSurface } from "../thread/threadCollapse";

describe("clampDocWidth", () => {
  it("keeps a width the host has room for", () => {
    expect(clampDocWidth(720, 900)).toBe(720);
  });

  it("never goes below the floor, however hard the pointer pushes left", () => {
    expect(clampDocWidth(40, 900)).toBe(MIN_DOC_WIDTH);
    expect(clampDocWidth(-3000, 900)).toBe(MIN_DOC_WIDTH);
  });

  it("holds a width to the room the host actually has", () => {
    expect(clampDocWidth(1400, 620)).toBe(620);
  });

  /**
   * The floor outranks the room, and it has to: a reader dragged into a sliver
   * of viewport has no room for 320px either, and clamping to the room there
   * would leave a body a few characters wide. The host's own box binds what is
   * *drawn* regardless — a `max-width` cannot widen a block past its container
   * — so the stored number staying readable costs nothing on screen.
   */
  it("prefers the floor to a room narrower than it", () => {
    expect(clampDocWidth(700, 90)).toBe(MIN_DOC_WIDTH);
  });

  it("treats an unmeasurable room as no constraint", () => {
    expect(clampDocWidth(1200, 0)).toBe(1200);
    expect(clampDocWidth(1200, Number.NaN)).toBe(1200);
  });

  it("caps the stored number so a stale value can never mean infinity", () => {
    expect(clampDocWidth(99_999, Number.POSITIVE_INFINITY)).toBe(MAX_DOC_WIDTH);
  });

  it("answers the floor for a width that is not a number at all", () => {
    expect(clampDocWidth(Number.NaN, 900)).toBe(MIN_DOC_WIDTH);
  });

  it("rounds, so the stored width is a whole pixel", () => {
    expect(clampDocWidth(640.6, 900)).toBe(641);
  });
});

describe("full screen's width store", () => {
  it("answers null while nobody has dragged", () => {
    expect(EMPTY_DOC_WIDTH_STATE.focus).toBeNull();
    expect(readDocWidthState(memoryStorage()).focus).toBeNull();
  });

  it("round-trips the chosen width through storage", () => {
    const storage = memoryStorage();
    writeDocWidthState({ version: DOC_WIDTH_STATE_VERSION, focus: 980 }, storage);
    expect(readDocWidthState(storage)).toEqual({ version: DOC_WIDTH_STATE_VERSION, focus: 980 });
  });

  /**
   * The migration the 2026-08-23 rider asks for, stated as behaviour: an old
   * blob holds one entry per column reader beside the focus entry. The column
   * surfaces no longer store a width — a column's body fills the column — so
   * only the focus key is honoured, and a user who set a full-screen width
   * keeps it.
   */
  it("honours the focus key inside a blob still holding column keys", () => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION,
        surfaces: {
          [columnSurface("doc_view_inbox")]: 700,
          [FOCUS_SURFACE]: 980,
          [columnSurface("doc_view_notes")]: 520,
        },
      }),
    });
    expect(readDocWidthState(storage).focus).toBe(980);
  });

  it("reads no width at all out of a blob holding only column keys", () => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION,
        surfaces: { [columnSurface("doc_view_inbox")]: 700 },
      }),
    });
    expect(readDocWidthState(storage)).toEqual(EMPTY_DOC_WIDTH_STATE);
  });

  /** "…dropped on the next write", not by a migration pass: the writer emits only focus. */
  it("prunes dead column entries on the next write", () => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION,
        surfaces: { [columnSurface("doc_view_inbox")]: 700, [FOCUS_SURFACE]: 980 },
      }),
    });
    writeDocWidthState({ version: DOC_WIDTH_STATE_VERSION, focus: 1040 }, storage);
    const raw: unknown = JSON.parse(storage.getItem(DOC_WIDTH_STORAGE_KEY) ?? "null");
    expect(raw).toEqual({
      version: DOC_WIDTH_STATE_VERSION,
      surfaces: { [FOCUS_SURFACE]: 1040 },
    });
  });

  /**
   * The stored shape and its version are the pre-rider ones on purpose: the
   * version is documented as "a change re-asserts the default", so bumping it
   * is exactly how the kept full-screen width would have been lost.
   */
  it("still writes version 1 under the original blob shape", () => {
    const storage = memoryStorage();
    writeDocWidthState({ version: DOC_WIDTH_STATE_VERSION, focus: 900 }, storage);
    const raw: unknown = JSON.parse(storage.getItem(DOC_WIDTH_STORAGE_KEY) ?? "null");
    expect(raw).toEqual({ version: 1, surfaces: { focus: 900 } });
  });

  it("serializes 'nobody has chosen' as no surfaces at all", () => {
    const storage = memoryStorage();
    writeDocWidthState(EMPTY_DOC_WIDTH_STATE, storage);
    const raw: unknown = JSON.parse(storage.getItem(DOC_WIDTH_STORAGE_KEY) ?? "null");
    expect(raw).toEqual({ version: DOC_WIDTH_STATE_VERSION, surfaces: {} });
  });

  it("reads nothing back when there is no storage at all", () => {
    expect(readDocWidthState(null)).toEqual(EMPTY_DOC_WIDTH_STATE);
    expect(() => {
      writeDocWidthState(EMPTY_DOC_WIDTH_STATE, null);
    }).not.toThrow();
  });

  /** Safari private mode: a width nobody can store is a shrug, not a crash. */
  it("shrugs when storage itself throws", () => {
    expect(readDocWidthState(throwingStorage())).toEqual(EMPTY_DOC_WIDTH_STATE);
    expect(() => {
      writeDocWidthState(EMPTY_DOC_WIDTH_STATE, throwingStorage());
    }).not.toThrow();
    expect(() => {
      clearDocWidthState(throwingStorage());
    }).not.toThrow();
  });

  it("degrades a blob from another version to the default", () => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION + 1,
        surfaces: { focus: 900 },
      }),
    });
    expect(readDocWidthState(storage)).toEqual(EMPTY_DOC_WIDTH_STATE);
  });

  it("degrades garbage to the default rather than throwing", () => {
    expect(readDocWidthState(memoryStorage({ [DOC_WIDTH_STORAGE_KEY]: "{not json" }))).toEqual(
      EMPTY_DOC_WIDTH_STATE,
    );
    expect(readDocWidthState(memoryStorage({ [DOC_WIDTH_STORAGE_KEY]: "[]" }))).toEqual(
      EMPTY_DOC_WIDTH_STATE,
    );
    expect(
      readDocWidthState(
        memoryStorage({
          [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
            version: DOC_WIDTH_STATE_VERSION,
            surfaces: "wide",
          }),
        }),
      ),
    ).toEqual(EMPTY_DOC_WIDTH_STATE);
  });

  it.each([
    ["a string", "wide"],
    ["a negative number", -12],
    ["zero", 0],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("ignores a stored focus value that is %s", (_label, value) => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION,
        surfaces: { focus: value },
      }),
    });
    expect(readDocWidthState(storage)).toEqual(EMPTY_DOC_WIDTH_STATE);
  });

  it("clears everything it wrote", () => {
    const storage = memoryStorage();
    writeDocWidthState({ version: DOC_WIDTH_STATE_VERSION, focus: 900 }, storage);
    clearDocWidthState(storage);
    expect(readDocWidthState(storage)).toEqual(EMPTY_DOC_WIDTH_STATE);
  });
});
