// SPEC.md §5's ramp, from `.corpus/config.json` to the response (SERVER-133).
//
// §5 has called 30/90/180 "defaults" since it was written, and nothing could
// change them: `WorkspaceConfigSchema` had no block, `STALENESS_THRESHOLD_DAYS`
// was a constant whose own comment called itself a default, and the only lever
// a person had was marking reference material `evergreen` one document at a
// time — an opt-out used to simulate a threshold.
//
// This suite is the guard against the failure `dataDir` recorded (SERVER-022
// finding 9): a key parsed, resolved into `ServerConfig`, and then read by
// nothing at all, so a workspace configured one way ran the other way and said
// nothing. It therefore asks the *route*, through `createServer`, reading the
// `ServerConfig` field `loadServerConfig` fills.

import { afterEach, describe, expect, it } from "vitest";
import { formatInstant } from "../core/time.js";
import { createWriteWorkspace, FIXTURE_NOW, type WriteWorkspace } from "./write-fixture.js";
import { STALENESS_THRESHOLD_DAYS, type StalenessThresholds } from "./staleness.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => formatInstant(FIXTURE_NOW - days * MS_PER_DAY);

/** A `type: note` whose age is `days`, written straight to disk and projected. */
function aged(id: string, days: number): void {
  ws.write(
    `data/docs/inbox/${id}.md`,
    [
      "---",
      `id: ${id}`,
      "type: note",
      `title: ${id}`,
      `created: ${daysAgo(days)}`,
      `updated: ${daysAgo(days)}`,
      "tags: []",
      "status: open",
      "anchors: {}",
      "due: null",
      "reviewed: null",
      "evergreen: false",
      "---",
      "",
      "A note nobody has touched.",
      "",
    ].join("\n"),
  );
}

/** Every document's reported tier, keyed by id, straight off `GET /api/docs`. */
async function tiers(): Promise<Record<string, string | null>> {
  const response = await ws.request("/api/docs?limit=50");
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { items: { id: string; stale: string | null }[] };
  return Object.fromEntries(payload.items.map((item) => [item.id, item.stale]));
}

/** The ids `?stale=<tier>` selects, sorted. */
async function atOrBeyond(tier: string): Promise<string[]> {
  const response = await ws.request(`/api/docs?limit=50&stale=${tier}`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { items: { id: string }[] };
  return payload.items.map((item) => item.id).sort();
}

function seed(name: string, staleness?: StalenessThresholds): void {
  ws = createWriteWorkspace(name, staleness === undefined ? {} : { staleness });
  aged("doc_ten", 10);
  aged("doc_twenty", 20);
  aged("doc_twentyfive", 25);
  aged("doc_hundred", 100);
  ws.reproject();
}

describe("the staleness ramp is the workspace's, not a constant", () => {
  it("is 30/90/180 for a workspace whose config carries no block", async () => {
    seed("staleness-default");

    expect(await tiers()).toMatchObject({
      doc_ten: null,
      doc_twenty: null,
      doc_twentyfive: null,
      doc_hundred: "stale",
    });
    expect(await atOrBeyond("aging")).toEqual(["doc_hundred"]);
    // The shipped numbers, stated once so a change to them is a decision.
    expect(STALENESS_THRESHOLD_DAYS).toEqual({ aging: 30, stale: 90, "very-stale": 180 });
  });

  it("ramps on the configured thresholds instead, on every surface at once", async () => {
    seed("staleness-tuned", { aging: 7, stale: 14, "very-stale": 21 });

    // Three documents the shipped ramp calls fresh now carry three tiers.
    expect(await tiers()).toMatchObject({
      doc_ten: "aging",
      doc_twenty: "stale",
      doc_twentyfive: "very-stale",
      doc_hundred: "very-stale",
    });
    expect(await atOrBeyond("aging")).toEqual([
      "doc_hundred",
      "doc_ten",
      "doc_twenty",
      "doc_twentyfive",
    ]);
    expect(await atOrBeyond("stale")).toEqual(["doc_hundred", "doc_twenty", "doc_twentyfive"]);
    expect(await atOrBeyond("very-stale")).toEqual(["doc_hundred", "doc_twentyfive"]);

    // §9.2's Attention reason is the same predicate, so it moves with them.
    const response = await ws.request("/api/docs?limit=50&needs=stale");
    const payload = (await response.json()) as { items: { id: string }[] };
    expect(payload.items.map((item) => item.id).sort()).toEqual([
      "doc_hundred",
      "doc_twenty",
      "doc_twentyfive",
    ]);
  });

  it("leaves the projection alone — no row stores a tier, so a rebuild writes the same bytes", async () => {
    seed("staleness-projection", { aging: 7, stale: 14, "very-stale": 21 });

    const before = ws.db.sqlite
      .prepare("SELECT id, updated, reviewed, evergreen, status FROM documents ORDER BY id")
      .all();
    ws.reproject();
    const after = ws.db.sqlite
      .prepare("SELECT id, updated, reviewed, evergreen, status FROM documents ORDER BY id")
      .all();

    // The tiers are computed in the query, from three bound cutoffs. Nothing a
    // rebuild writes depends on the thresholds, which is why changing them
    // needs no reprojection and `db doctor` cannot notice the edit.
    expect(after).toEqual(before);
    expect(Object.keys(before[0] ?? {})).not.toContain("stale");
    expect(await tiers()).toMatchObject({ doc_ten: "aging" });
  });
});
