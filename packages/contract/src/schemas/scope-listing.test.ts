import { describe, expect, it } from "vitest";
import {
  SCOPE_MEMBER_KINDS,
  SCOPE_MEMBER_VIAS,
  SCOPE_PAGE_SIZE,
  ScopeMemberSchema,
  ThreadScopeSchema,
} from "./scope-listing.js";

const root = { id: "th_x9y8", kind: "thread", title: "Re: rates", status: "open", via: "self" };
const draft = {
  id: "doc_a1b2c3",
  kind: "doc",
  title: "Mortgage options",
  status: "archived",
  via: "origin",
};
const child = {
  id: "th_child1",
  kind: "thread",
  title: "Re: Mortgage options",
  status: "resolved",
  via: "parent",
};

describe("ScopeMember", () => {
  it("is one frugal line: id, kind, title, status, via — and never a body", () => {
    expect(ScopeMemberSchema.parse(root)).toEqual(root);
    expect(Object.keys(ScopeMemberSchema.shape)).toEqual(["id", "kind", "title", "status", "via"]);
    expect("body" in ScopeMemberSchema.shape).toBe(false);
    expect("excerpt" in ScopeMemberSchema.shape).toBe(false);
  });

  it("closes kind and via at the decided sets", () => {
    expect([...SCOPE_MEMBER_KINDS]).toEqual(["thread", "doc"]);
    expect([...SCOPE_MEMBER_VIAS]).toEqual(["self", "parent", "origin"]);
    expect(ScopeMemberSchema.safeParse({ ...root, via: "lane" }).success).toBe(false);
    expect(ScopeMemberSchema.safeParse({ ...root, kind: "note" }).success).toBe(false);
  });

  /** Archiving does not touch origin or parent, so an archived document stays in scope and says so. */
  it("lists an archived document as a member, with its status on the row", () => {
    expect(ScopeMemberSchema.parse(draft).status).toBe("archived");
  });

  it("takes either id prefix, since a thread is a document", () => {
    expect(ScopeMemberSchema.parse(child).id).toBe("th_child1");
    expect(ScopeMemberSchema.parse(draft).id).toBe("doc_a1b2c3");
    expect(ScopeMemberSchema.safeParse({ ...root, id: "rates" }).success).toBe(false);
  });
});

describe("ThreadScope", () => {
  const listing = { thread: "th_x9y8", members: [root, draft, child], truncated: false };

  it("round-trips the root and its members", () => {
    expect(ThreadScopeSchema.parse(listing)).toEqual(listing);
  });

  it("names the root with a thread id, never a document id", () => {
    expect(ThreadScopeSchema.safeParse({ ...listing, thread: "doc_a1b2c3" }).success).toBe(false);
  });

  /**
   * The bound is the contract's, not a flag's: a page past it is refused at the
   * schema, and `truncated` is required so a capped list cannot read as whole.
   */
  it("caps the page at the published size and demands the truncated flag", () => {
    const full = Array.from({ length: SCOPE_PAGE_SIZE }, (_, index) => ({
      ...draft,
      id: `doc_m${String(index)}`,
    }));
    expect(ThreadScopeSchema.safeParse({ ...listing, members: full }).success).toBe(true);
    expect(
      ThreadScopeSchema.safeParse({ ...listing, members: [...full, draft], truncated: true })
        .success,
    ).toBe(false);
    expect(ThreadScopeSchema.safeParse({ thread: "th_x9y8", members: [root] }).success).toBe(false);
  });

  it("publishes no cursor and no total: the bound is a bound, not a page", () => {
    expect(Object.keys(ThreadScopeSchema.shape)).toEqual(["thread", "members", "truncated"]);
    expect(SCOPE_PAGE_SIZE).toBe(200);
  });
});
