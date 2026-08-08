import { describe, expect, it } from "vitest";
import { CONTEXT_WINDOW } from "../anchors/index.js";
import { HttpError } from "../errors.js";
import { contextualizeSelector, countOccurrences, locateAnchor } from "./anchor-context.js";

const selector = (
  exact: string,
  prefix = "",
  suffix = "",
): { exact: string; prefix: string; suffix: string } => ({ exact, prefix, suffix });

interface Refusal {
  readonly status: number;
  readonly message: string;
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

/** The refusal, narrowed to the `bad_request` arm ambiguity is contracted to throw. */
const refusal = (body: string, sent: ReturnType<typeof selector>): Refusal => {
  try {
    locateAnchor(body, sent);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.body.code !== "bad_request") {
      throw new Error(`refused as ${error.body.code}`, { cause: error });
    }
    return { status: error.status, message: error.body.message, issues: error.body.issues };
  }
  throw new Error("expected locateAnchor to refuse");
};

describe("countOccurrences", () => {
  it("counts overlapping occurrences, as rung 2 of the ladder does", () => {
    expect(countOccurrences("aaaa", "aa", 5)).toBe(3);
  });

  it("stops at the limit rather than scanning the whole body", () => {
    expect(countOccurrences("x".repeat(10_000), "x", 2)).toBe(2);
  });

  it("is zero for an absent needle and for the empty one", () => {
    expect(countOccurrences("abc", "d", 2)).toBe(0);
    expect(countOccurrences("abc", "", 2)).toBe(0);
  });
});

describe("locateAnchor", () => {
  it("finds a unique quote with no context sent at all", () => {
    expect(locateAnchor("the quick brown fox", selector("brown"))).toBe(10);
  });

  it("returns null for a quote the body does not contain", () => {
    expect(locateAnchor("the quick brown fox", selector("purple"))).toBeNull();
  });

  it("lets the sent context choose between repeated quotes", () => {
    const body = "ship it now\n\nthen ship it later\n";
    expect(locateAnchor(body, selector("ship it", "then "))).toBe(18);
  });

  it("ignores context that is not in the file when the quote is unique anyway", () => {
    // The agent's usual case: framing it never read, around a quote it did.
    expect(locateAnchor("the quick brown fox", selector("brown", "very ", " furry"))).toBe(10);
  });

  it("refuses a repeated quote rather than taking the first occurrence", () => {
    const refused = refusal("ship it now, then ship it later", selector("ship it"));
    expect(refused.status).toBe(400);
    expect(refused.message).toContain("more than once");
    expect(refused.issues[0]?.path).toBe("selector.exact");
    expect(refused.issues[0]?.message).toContain("prefix");
  });

  it("counts overlapping occurrences as ambiguity too", () => {
    expect(refusal("aaa", selector("aa")).status).toBe(400);
  });

  it("refuses when the sent framing is itself repeated", () => {
    const body = "then ship it later, then ship it later";
    const refused = refusal(body, selector("ship it", "then ", " later"));
    expect(refused.status).toBe(400);
    expect(refused.message).toContain("context");
  });
});

describe("contextualizeSelector", () => {
  it("reads the context off the body, discarding what the caller sent", () => {
    const body = "The model we assume a 30-year fixed rate which may be stale.\n";
    const stored = contextualizeSelector(body, selector("a 30-year fixed rate", "we ", " which"));
    expect(stored).toEqual({
      exact: "a 30-year fixed rate",
      prefix: "The model we assume ",
      suffix: " which may be stale.\n",
    });
    // What was stored is in the file verbatim — rung 1 resolves it as written.
    expect(body).toContain(`${stored.prefix}${stored.exact}${stored.suffix}`);
  });

  it("takes no more than the context window on each side", () => {
    const body = `${"a".repeat(100)}TARGET${"b".repeat(100)}`;
    const stored = contextualizeSelector(body, selector("TARGET"));
    expect(stored.prefix).toBe("a".repeat(CONTEXT_WINDOW));
    expect(stored.suffix).toBe("b".repeat(CONTEXT_WINDOW));
  });

  it("leaves genuinely context-free anchors context-free", () => {
    // A quote spanning the whole body has no surroundings to read; this — not an
    // agent's omission — is what the empty strings are for.
    expect(contextualizeSelector("TARGET", selector("TARGET"))).toEqual({
      exact: "TARGET",
      prefix: "",
      suffix: "",
    });
  });

  it("keeps the request's own context when the quote is nowhere in the body", () => {
    const sent = selector("not here", "before ", " after");
    expect(contextualizeSelector("some other prose entirely", sent)).toEqual(sent);
  });

  it("is verbatim about whitespace — a padded table cell keeps its padding", () => {
    const body = "| Q1      | 12,400 | ops   |\n| Q2      | 18,900 | ops   |\n";
    const stored = contextualizeSelector(body, selector("18,900", "| Q2 | ", " | ops |"));
    expect(stored.prefix).toBe(" | 12,400 | ops   |\n| Q2      | ");
    expect(stored.suffix).toBe(" | ops   |\n");
  });
});
