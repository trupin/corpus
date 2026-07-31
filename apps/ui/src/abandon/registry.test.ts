import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceAbandoned,
  forgetDoc,
  isAbandoned,
  isDisplayed,
  markAbandoned,
  publishBodyDraft,
  publishDoc,
  publishTitleDraft,
  releaseDoc,
  resetAbandonRegistry,
  retainDoc,
  snapshotOf,
  subscribeAbandoned,
} from "./registry";

afterEach(() => {
  resetAbandonRegistry();
});

const BASE = { type: "note", title: "Untitled", body: "", threadCount: 0, hasExtra: false };

describe("the live document registry", () => {
  it("answers nothing about a document nobody published", () => {
    expect(snapshotOf("doc_unknown")).toBeNull();
  });

  it("lays the live drafts over the corpus's copy", () => {
    publishDoc("doc_a", { ...BASE, title: "Saved title", body: "saved body" });
    expect(snapshotOf("doc_a")).toMatchObject({ title: "Saved title", body: "saved body" });

    publishTitleDraft("doc_a", "typed title");
    publishBodyDraft("doc_a", "typed body");
    expect(snapshotOf("doc_a")).toMatchObject({ title: "typed title", body: "typed body" });
  });

  it("clears a draft that was reverted", () => {
    publishDoc("doc_a", BASE);
    publishTitleDraft("doc_a", "typed");
    publishTitleDraft("doc_a", null);
    expect(snapshotOf("doc_a")?.title).toBe("Untitled");
  });

  it("keeps an empty draft, which is the whole typed-then-erased case", () => {
    publishDoc("doc_a", { ...BASE, title: "Named", body: "written" });
    publishTitleDraft("doc_a", "");
    publishBodyDraft("doc_a", "");
    expect(snapshotOf("doc_a")).toMatchObject({ title: "", body: "" });
  });

  it("ignores an empty document id from a host with nothing open", () => {
    publishDoc("", BASE);
    publishTitleDraft("", "x");
    publishBodyDraft("", "x");
    retainDoc("");
    expect(snapshotOf("")).toBeNull();
    expect(isDisplayed("")).toBe(false);
  });

  it("only releases on the last host showing the document", () => {
    retainDoc("doc_a");
    retainDoc("doc_a");
    expect(releaseDoc("doc_a")).toBe(false);
    expect(isDisplayed("doc_a")).toBe(true);
    expect(releaseDoc("doc_a")).toBe(true);
    expect(isDisplayed("doc_a")).toBe(false);
  });

  it("releasing a document nobody retained is not a release", () => {
    expect(releaseDoc("doc_a")).toBe(false);
  });

  it("forgets everything about an abandoned document", () => {
    publishDoc("doc_a", BASE);
    publishTitleDraft("doc_a", "t");
    publishBodyDraft("doc_a", "b");
    markAbandoned("doc_a");
    expect(isAbandoned("doc_a")).toBe(true);

    forgetDoc("doc_a");
    expect(snapshotOf("doc_a")).toBeNull();
    expect(isAbandoned("doc_a")).toBe(false);
  });

  it("tells every subscriber, and stops when they unsubscribe", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stop = subscribeAbandoned(first);
    subscribeAbandoned(second);

    announceAbandoned("doc_a");
    expect(first).toHaveBeenCalledWith("doc_a");
    expect(second).toHaveBeenCalledWith("doc_a");

    stop();
    announceAbandoned("doc_b");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("survives a subscriber that unsubscribes while being told", () => {
    const stop = subscribeAbandoned(() => {
      stop();
    });
    expect(() => {
      announceAbandoned("doc_a");
    }).not.toThrow();
  });
});
