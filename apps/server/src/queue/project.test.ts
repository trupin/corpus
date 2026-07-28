import { describe, expect, it } from "vitest";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "../events/index.js";
import { QUEUE_QUERY_KEYS } from "./project.js";

describe("the queue's invalidation key table", () => {
  it("names the queue, the job list and the document collection", () => {
    // Pinned by value, not by symbol: every call site imports the constant, so
    // only a literal assertion can catch a key going missing (SERVER-028).
    expect(QUEUE_QUERY_KEYS).toEqual([["queue"], ["jobs"], ["docs"]]);
    expect(QUEUE_QUERY_KEYS).toEqual([QUEUE_KEY, JOBS_KEY, DOCS_KEY]);
  });

  it("carries the document collection because `failed-job` reads `events.status`", () => {
    // SPEC.md §2.2: a write invalidates every query whose answer it changes.
    // `GET /api/docs?needs=me` counts documents named by a *failed* event
    // (`docs/needs.ts` FAILED_JOB_SQL), so a transition ages that collection.
    expect(QUEUE_QUERY_KEYS).toContainEqual(DOCS_KEY);
  });
});
