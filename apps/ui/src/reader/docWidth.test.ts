/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage.js";
import {
  DOC_WIDTH_STATE_VERSION,
  DOC_WIDTH_STORAGE_KEY,
  EMPTY_DOC_WIDTH_STATE,
  MAX_DOC_WIDTH,
  MAX_WIDTH_SURFACES,
  MIN_DOC_WIDTH,
  clampDocWidth,
  clearDocWidthState,
  readDocWidthState,
  surfaceWidth,
  withSurfaceWidth,
  writeDocWidthState,
  type DocWidthState,
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

describe("the per-surface store", () => {
  it("answers null for a surface nobody has dragged", () => {
    expect(surfaceWidth(EMPTY_DOC_WIDTH_STATE, columnSurface("doc_view_inbox"))).toBeNull();
  });

  /**
   * The keys are UI-077's keys, and this is the assertion that says so: a
   * column reader per column, one focus surface, distinct from each other.
   */
  it("keys a column reader per column and focus mode once", () => {
    let state: DocWidthState = EMPTY_DOC_WIDTH_STATE;
    state = withSurfaceWidth(state, columnSurface("doc_view_inbox"), 700);
    state = withSurfaceWidth(state, columnSurface("doc_view_notes"), 520);
    state = withSurfaceWidth(state, FOCUS_SURFACE, 980);

    expect(surfaceWidth(state, columnSurface("doc_view_inbox"))).toBe(700);
    expect(surfaceWidth(state, columnSurface("doc_view_notes"))).toBe(520);
    expect(surfaceWidth(state, FOCUS_SURFACE)).toBe(980);
  });

  it("replaces a surface's width rather than accumulating", () => {
    const key = columnSurface("doc_view_inbox");
    const state = withSurfaceWidth(withSurfaceWidth(EMPTY_DOC_WIDTH_STATE, key, 700), key, 820);
    expect(state.surfaces).toEqual({ [key]: 820 });
  });

  it("drops the least recently chosen surface past the bound", () => {
    let state: DocWidthState = EMPTY_DOC_WIDTH_STATE;
    for (let index = 0; index < MAX_WIDTH_SURFACES + 5; index += 1) {
      state = withSurfaceWidth(state, columnSurface(`col_${String(index)}`), 400 + index);
    }
    expect(Object.keys(state.surfaces)).toHaveLength(MAX_WIDTH_SURFACES);
    expect(surfaceWidth(state, columnSurface("col_0"))).toBeNull();
    expect(surfaceWidth(state, columnSurface(`col_${String(MAX_WIDTH_SURFACES + 4)}`))).toBe(
      400 + MAX_WIDTH_SURFACES + 4,
    );
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const key = columnSurface("doc_view_inbox");
    writeDocWidthState(withSurfaceWidth(EMPTY_DOC_WIDTH_STATE, key, 760), storage);
    expect(surfaceWidth(readDocWidthState(storage), key)).toBe(760);
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
  });

  it("ignores a stored value that is not a usable width", () => {
    const storage = memoryStorage({
      [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({
        version: DOC_WIDTH_STATE_VERSION,
        surfaces: { focus: "wide", "col:a": -12, "col:b": 640 },
      }),
    });
    expect(readDocWidthState(storage).surfaces).toEqual({ "col:b": 640 });
  });

  it("clears everything it wrote", () => {
    const storage = memoryStorage();
    writeDocWidthState(withSurfaceWidth(EMPTY_DOC_WIDTH_STATE, FOCUS_SURFACE, 900), storage);
    clearDocWidthState(storage);
    expect(readDocWidthState(storage)).toEqual(EMPTY_DOC_WIDTH_STATE);
  });
});
