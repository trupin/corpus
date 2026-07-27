import { describe, expect, it } from "vitest";
import { SELF_WRITE_TTL_MS, createSelfWriteRegistry } from "./self-writes.js";

const PATH = "/ws/data/docs/mortgage.md";

describe("createSelfWriteRegistry", () => {
  it("claims a write whose bytes it registered", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, "hello");

    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(true);
  });

  it("does not claim different bytes at the same path — the point of content matching", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, "ours");

    // TEST-20: an external process writing to the same path inside the window is
    // a genuine out-of-band edit and must reach the projection.
    expect(registry.claim(PATH, Buffer.from("theirs"))).toBe(false);
    expect(registry.size).toBe(1);
  });

  it("does not claim the same bytes at a different path", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, "hello");

    expect(registry.claim("/ws/data/docs/other.md", Buffer.from("hello"))).toBe(false);
  });

  it("claims a registered removal, and only a removal", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, null);

    expect(registry.claim(PATH, Buffer.from(""))).toBe(false);
    expect(registry.claim(PATH, null)).toBe(true);
  });

  it("re-arms the window each time the same write is recorded", () => {
    let now = 0;
    const registry = createSelfWriteRegistry({ ttlMs: 10, now: () => now });
    registry.record(PATH, "hello");
    now = 8;
    registry.record(PATH, "hello");

    now = 12;
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(true);
    now = 19;
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(false);
  });

  it("claims every event of one write, because an atomic write is several", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, "hello");

    // A rename over an existing file can surface as an unlink, an add and a
    // change; consuming on the first match would let the rest through.
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(true);
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(true);
  });

  it("keeps one entry per path and content, however often it is recorded", () => {
    const registry = createSelfWriteRegistry();
    registry.record(PATH, "hello");
    registry.record(PATH, "hello");

    expect(registry.size).toBe(1);
  });

  it("expires an entry that never produced a watcher event", () => {
    let now = 1_000;
    const registry = createSelfWriteRegistry({ now: () => now });
    registry.record(PATH, "hello");

    now += SELF_WRITE_TTL_MS - 1;
    expect(registry.size).toBe(1);

    now += 1;
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("honours a custom TTL", () => {
    let now = 0;
    const registry = createSelfWriteRegistry({ ttlMs: 10, now: () => now });
    registry.record(PATH, "hello");

    now = 11;
    expect(registry.claim(PATH, Buffer.from("hello"))).toBe(false);
  });
});
