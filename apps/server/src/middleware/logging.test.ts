import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLogger, type LogSink } from "../logger.js";
import { REDACTED, createRequestLogger, describeRequestTarget, redactQuery } from "./logging.js";

function collectingSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("redactQuery", () => {
  it.each([
    ["", ""],
    ["q=hello", "q=hello"],
    ["token=secret", `token=${REDACTED}`],
    ["TOKEN=secret", `TOKEN=${REDACTED}`],
    ["access_token=secret", `access_token=${REDACTED}`],
    ["q=hello&token=secret&sort=-updated", `q=hello&token=${REDACTED}&sort=-updated`],
    ["token=a&token=b", `token=${REDACTED}`],
  ])("redacts %j to %j", (input, expected) => {
    expect(redactQuery(input)).toBe(expected);
  });

  it("survives a percent-encoding-safe round trip", () => {
    expect(redactQuery("token=secret")).not.toContain("%");
  });
});

describe("describeRequestTarget", () => {
  it("splits a URL into its path and its redacted query", () => {
    expect(describeRequestTarget("http://127.0.0.1:8765/events?token=secret")).toEqual({
      path: "http://127.0.0.1:8765/events",
      query: `token=${REDACTED}`,
    });
  });

  it("reports an empty query when there is none", () => {
    expect(describeRequestTarget("http://127.0.0.1:8765/api/health")).toEqual({
      path: "http://127.0.0.1:8765/api/health",
      query: "",
    });
  });
});

describe("createRequestLogger", () => {
  function app(sink: LogSink, now: () => number): Hono {
    const hono = new Hono();
    hono.use("*", createRequestLogger(createLogger("info", sink), now));
    hono.get("/api/health", (c) => c.json({ status: "ok" }));
    hono.get("/events", (c) => c.text("stream"));
    return hono;
  }

  it("emits method, path, status and duration after the response", async () => {
    const sink = collectingSink();
    let clock = 1000;
    await app(sink, () => (clock += 5)).request("/api/health");

    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({
      level: "info",
      msg: "request",
      method: "GET",
      path: "/api/health",
      status: 200,
      durationMs: 5,
    });
  });

  it("logs the 404 status of an unmatched route", async () => {
    const sink = collectingSink();
    await app(sink, () => 0).request("/api/nope");
    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({ path: "/api/nope", status: 404 });
  });

  it("records the path but never the presented token", async () => {
    const sink = collectingSink();
    await app(sink, () => 0).request("/events?token=super-secret-token");

    const line = sink.lines[0] ?? "";
    expect(line).not.toContain("super-secret-token");
    expect(JSON.parse(line)).toMatchObject({ path: "/events", query: `token=${REDACTED}` });
  });

  it("omits the query field entirely when there is no query string", async () => {
    const sink = collectingSink();
    await app(sink, () => 0).request("/api/health");
    expect(JSON.parse(sink.lines[0] ?? "")).not.toHaveProperty("query");
  });

  it("uses a real clock by default", async () => {
    const sink = collectingSink();
    const hono = new Hono();
    hono.use("*", createRequestLogger(createLogger("info", sink)));
    hono.get("/", (c) => c.text("ok"));

    await hono.request("/");
    const entry = JSON.parse(sink.lines[0] ?? "") as { durationMs: number };
    expect(entry.durationMs).toEqual(expect.any(Number));
  });
});
