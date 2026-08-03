import { docKey } from "@corpus/kit";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { UNRESOLVED_REF } from "./clipboard.js";
import { refResolver } from "./refResolver.js";

/** Enough of a `Doc` for a title lookup; the rest of the payload is not read. */
function cached(client: QueryClient, id: string, title: string): void {
  client.setQueryData(docKey(id), {
    body: "",
    path: `data/docs/inbox/${id}.md`,
    anchors: [],
    frontmatter: { id, title },
  });
}

describe("the clipboard's ref resolver", () => {
  it("answers a cached document's current title", () => {
    const client = new QueryClient();
    cached(client, "doc_a1b2c3", "Lender spreads");
    expect(refResolver(client)("doc_a1b2c3")).toEqual({ title: "Lender spreads", href: null });
  });

  it("resolves nothing for a document the cache has not seen", () => {
    expect(refResolver(new QueryClient())("doc_a1b2c3")).toBe(UNRESOLVED_REF);
  });

  it("treats an empty title as no title", () => {
    const client = new QueryClient();
    cached(client, "doc_a1b2c3", "");
    expect(refResolver(client)("doc_a1b2c3")).toBe(UNRESOLVED_REF);
  });

  it("never invents an external address for a document (SPEC.md §11 rider)", () => {
    const client = new QueryClient();
    cached(client, "doc_a1b2c3", "Lender spreads");
    expect(refResolver(client)("doc_a1b2c3").href).toBeNull();
  });
});
