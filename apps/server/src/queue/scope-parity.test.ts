// **One walk, two directions, held against each other** (SERVER-130).
//
// `createLaneScopeLookup` climbs from an artifact to the lane whose scope it
// falls in — the decision every enqueued event is stamped with. `listScopeMembers`
// answers the inverse — given a lane, what is in it. They are the same rule read
// two ways, and the whole of §7's promise to a person reading "what does this
// agent own" is that the second is exactly the set the first produces.
//
// So this file asks both of one corpus and compares the answers, in the shape of
// `scripts/mention-offer-parity.test.ts`: a unit test on either side alone can
// only ever restate that side's opinion. `packages/kit/src/recipient/scopeWalk.ts`
// records what a second implementation cost the last time — a composer said
// *"Orchestrator will answer"* about a conversation the server routed to Ana, and
// Ana never heard about the conversation on the draft she wrote.
//
// ## The corpus is derived, not written out
//
// The value of a parity test is exactly the set of shapes it thinks to ask
// about, and a hand-written list is a test of what its author imagined. So the
// graph below is a **cross-product**: every parent source against every origin
// source, one thread per pair, one document per origin source, and one more
// document hanging off every generated thread. That produces the shapes nobody
// would think to write — a thread whose parent chain reaches one lane while its
// own origin reaches another, a document whose origin is a thread whose parent
// is that document, an edge naming an artifact this workspace does not hold —
// and it produces them again, unasked, if a source is added to either list.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE, type Lane, type ScopeMember } from "@corpus/contract";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { createLaneScopeLookup, isDesignatedRoot, listScopeMembers } from "./scope.js";

/** The two designated standalone threads: the lanes everything below is sorted into. */
const LANE_A = "th_laneA";
const LANE_B = "th_laneB";
/** A standalone thread nobody designated: a real node, and never a destination. */
const PLAIN = "th_plain";
/** An id no file ever carries — a deleted thread, or one from another workspace. */
const GHOST = "th_ghost";
/** …and the same for a document, so a thread's `parent` can dead-end too. */
const GHOST_DOC = "doc_ghost";

/** Every value a document's `origin`, or a thread's, can take in this corpus. */
const ORIGIN_SOURCES: readonly (string | null)[] = [LANE_A, LANE_B, PLAIN, GHOST, null];

const label = (value: string | null): string => (value === null ? "Nil" : value.replace("_", ""));

/** The document seeded for each origin source, so a thread's parent can point into a scope. */
const docForOrigin = (origin: string | null): string => `doc_o${label(origin)}`;

/** Every value a generated thread's `parent` can take: null, the roots, and the documents above. */
const PARENT_SOURCES: readonly (string | null)[] = [
  null,
  LANE_A,
  LANE_B,
  PLAIN,
  GHOST_DOC,
  ...ORIGIN_SOURCES.map(docForOrigin),
];

const generatedThread = (parent: string | null, origin: string | null): string =>
  `th_p${label(parent)}o${label(origin)}`;

/** A document written *by* each generated thread, which is how a scope grows a second level. */
const docForThread = (thread: string): string => `doc_by${label(thread)}`;

const designated = { name: null, docId: null, weight: null };

let ws: Workspace;

beforeAll(() => {
  ws = createWorkspace("scope-parity");

  // The roots. Two lanes, so "in some scope" and "in *this* scope" are different
  // claims, and one undesignated standalone thread, so a branch can be real and
  // still reach nothing.
  for (const lane of [LANE_A, LANE_B]) {
    ws.thread({ id: lane, title: `Lane ${lane}`, frontmatter: { resident: designated } });
  }
  ws.thread({ id: PLAIN, title: "Undesignated" });

  // One document per origin source, including the dangling one and the unfiled one.
  for (const origin of ORIGIN_SOURCES) {
    ws.doc({
      id: docForOrigin(origin),
      title: `Written from ${label(origin)}`,
      ...(origin === null ? {} : { frontmatter: { origin } }),
    });
  }

  // The cross-product: every parent against every origin.
  for (const parent of PARENT_SOURCES) {
    for (const origin of ORIGIN_SOURCES) {
      const id = generatedThread(parent, origin);
      ws.thread({
        id,
        title: `Thread ${id}`,
        parent,
        ...(origin === null ? {} : { frontmatter: { origin } }),
      });
      // …and a document that thread's own job wrote, so membership has to be
      // reached through two edges in a row rather than one.
      ws.doc({ id: docForThread(id), title: `Written from ${id}`, frontmatter: { origin: id } });
    }
  }

  // Two cycles, because §5 makes the files the source of truth and a hand-edited
  // pair can name each other. Neither reaches a lane; both must simply terminate.
  ws.thread({ id: "th_cycA", title: "Cycle A", parent: "th_cycB" });
  ws.thread({ id: "th_cycB", title: "Cycle B", parent: "th_cycA" });
  ws.doc({ id: "doc_cyc", title: "Cycle doc", frontmatter: { origin: "th_cycD" } });
  ws.thread({ id: "th_cycD", title: "Cycle D", parent: "doc_cyc" });

  ws.reproject();
});

afterAll(() => {
  ws.close();
});

/** Every artifact the corpus holds, threads included — a thread is a document (§6). */
const everyArtifact = (): string[] =>
  (ws.db.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]).map(
    (row) => row.id,
  );

/**
 * **The enqueue direction, through the enqueue path's own entry point.** The
 * payload shapes are the real ones: `comment.created` names its thread, and
 * `doc.edited` names only a document (`core/provenance.ts`).
 */
const enqueueLane = (id: string): Lane => {
  const lookup = createLaneScopeLookup(ws.db);
  return lookup(id.startsWith("th_") ? { threadId: id } : { docId: id });
};

/** The listing direction. The root's own line is the route's; only its id matters here. */
const listing = (lane: string): { members: readonly ScopeMember[]; truncated: boolean } => {
  const root: ScopeMember = { id: lane, kind: "thread", title: lane, status: "open", via: "self" };
  return listScopeMembers(ws.db, root);
};

const listedIds = (lane: string): string[] => listing(lane).members.map((member) => member.id);

/** What the *climb* says belongs to `lane` — the set the listing has to reproduce. */
const climbedInto = (lane: string): string[] =>
  everyArtifact().filter((id) => enqueueLane(id) === lane);

describe("the corpus both directions are asked about", () => {
  /**
   * The derivation first: with an empty or partial cross-product every agreement
   * below would hold of a listing that returned nothing.
   */
  it("holds the shapes the comparison is worth anything for", () => {
    const artifacts = everyArtifact();
    expect(artifacts.length).toBeGreaterThan(80);
    // Both roots really are lanes — if the resident's stored shape ever drifts,
    // this is what says so, rather than every listing quietly emptying.
    expect(isDesignatedRoot(ws.db, LANE_A)).toBe(true);
    expect(isDesignatedRoot(ws.db, LANE_B)).toBe(true);
    expect(isDesignatedRoot(ws.db, PLAIN)).toBe(false);
    // The dangling ids are dangling: an edge into nothing is one of the shapes
    // being asked about, so it must not accidentally exist.
    expect(artifacts).not.toContain(GHOST);
    expect(artifacts).not.toContain(GHOST_DOC);
  });

  it("routes artifacts to both lanes, and others to neither", () => {
    expect(climbedInto(LANE_A).length).toBeGreaterThan(10);
    expect(climbedInto(LANE_B).length).toBeGreaterThan(10);
    expect(climbedInto(ORCHESTRATOR_LANE).length).toBeGreaterThan(10);
  });

  /**
   * And it holds the shape the two directions can most easily disagree about: an
   * artifact with **both** edges, each reaching a different lane. §7 ranks the
   * parent chain first, and this is the input where that ranking is observable.
   */
  it("holds an artifact whose two edges reach different lanes", () => {
    const contested = generatedThread(LANE_A, LANE_B);
    expect(everyArtifact()).toContain(contested);
    expect(enqueueLane(contested)).toBe(LANE_A);
  });
});

describe.each([
  ["lane A", LANE_A],
  ["lane B", LANE_B],
])("%s's listing", (_name, lane) => {
  /**
   * The claim in full, in both directions at once: every artifact the enqueue
   * walk routes here is listed, and every artifact listed here is one the enqueue
   * walk routes here. A set comparison rather than a length one, so a failure
   * names the artifacts rather than a count (PR #50 NIT 7's lesson).
   */
  it("is exactly the set the enqueue walk routes to it", () => {
    expect(listing(lane).truncated).toBe(false);
    expect(new Set(listedIds(lane))).toEqual(new Set([lane, ...climbedInto(lane)]));
  });

  /** The root is the scope's own first line, and it is a member of nothing else. */
  it("starts with the lane itself", () => {
    expect(listedIds(lane)[0]).toBe(lane);
    expect(listing(lane).members[0]?.via).toBe("self");
  });

  /**
   * `via` is the edge the walk took, checked against the walk and not against the
   * row's columns: a member reports `parent` exactly when climbing from its
   * parent lands on this lane. A member whose parent chain dead-ends and whose
   * origin carried it here is the case a column-reading implementation gets
   * wrong, and the cross-product holds several.
   */
  it("reports the edge that actually reached the lane", () => {
    const parents = new Map(
      (
        ws.db.prepare("SELECT id, parent_id AS parent FROM threads").all() as {
          id: string;
          parent: string | null;
        }[]
      ).map((row) => [row.id, row.parent]),
    );
    for (const member of listing(lane).members) {
      if (member.via === "self") continue;
      const parent = parents.get(member.id) ?? null;
      const viaParent = parent !== null && enqueueLane(parent) === lane;
      expect([member.id, member.via]).toEqual([member.id, viaParent ? "parent" : "origin"]);
    }
  });
});

describe("the two listings together", () => {
  /** No artifact is in two scopes: the walk answers one lane, so the sets cannot overlap. */
  it("share no member but nothing at all", () => {
    const both = listedIds(LANE_A).filter((id) => listedIds(LANE_B).includes(id));
    expect(both).toEqual([]);
  });

  /**
   * …and what neither lists is what the queue hands the orchestrator. Stated as a
   * partition over the whole corpus, so an artifact that fell out of both
   * directions at once — the failure a per-lane comparison cannot see — is a
   * failure here.
   */
  it("partition the corpus with the orchestrator's remainder", () => {
    const listed = new Set([...listedIds(LANE_A), ...listedIds(LANE_B)]);
    const unlisted = everyArtifact().filter((id) => !listed.has(id));
    expect(unlisted).toEqual(climbedInto(ORCHESTRATOR_LANE));
  });
});
