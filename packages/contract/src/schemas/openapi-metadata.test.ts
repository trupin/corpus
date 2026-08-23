import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRoute, OpenAPIHono, z as annotated } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * The claim {@link openapi} makes is that it is the same annotation `.openapi()`
 * is, so these tests generate a document **both ways** and compare the bytes.
 *
 * A test that only read the metadata back would pass while the generator ignored
 * it, which is the whole failure mode: the annotation is invisible until a
 * document is built from it. The same reasoning is why `openapi.json` being
 * byte-identical is the acceptance test for CONTRACT-082 rather than a reading
 * of the diff.
 */

/** One route carrying `schema` as its response, rendered as the document bytes. */
function documentFor(
  schema: z.ZodType,
  params: z.ZodObject = z.object({ id: z.string() }),
  query: z.ZodObject = z.object({}),
): string {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/thing/{id}",
      request: { params, query },
      responses: {
        200: { description: "ok", content: { "application/json": { schema } } },
      },
    }),
  );
  return JSON.stringify(
    app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } }),
    null,
    2,
  );
}

describe("openapi()", () => {
  it("names a component exactly as `.openapi(refId)` does", () => {
    const ours = documentFor(openapi(z.object({ a: z.string() }), "Thing"));
    const theirs = documentFor(annotated.object({ a: annotated.string() }).openapi("Thing"));

    expect(ours).toEqual(theirs);
    expect(ours).toContain('"$ref": "#/components/schemas/Thing"');
  });

  it("carries a description and an example onto a field, as the method does", () => {
    const ours = documentFor(
      z.object({ a: openapi(z.string(), { description: "the a", example: "x" }) }),
    );
    const theirs = documentFor(
      annotated.object({
        a: annotated.string().openapi({ description: "the a", example: "x" }),
      }),
    );

    expect(ours).toEqual(theirs);
    expect(ours).toContain("the a");
  });

  it("binds a path parameter and a defaulted query parameter identically", () => {
    const ourParams = z.object({
      id: openapi(z.string(), { param: { name: "id", in: "path", required: true } }),
    });
    const ourQuery = z.object({
      limit: openapi(z.coerce.number().int().min(1).max(9).default(5), {
        param: { name: "limit", in: "query", required: false },
        type: "integer",
        description: "how many",
      }),
    });
    const theirParams = annotated.object({
      id: annotated.string().openapi({ param: { name: "id", in: "path", required: true } }),
    });
    const theirQuery = annotated.object({
      limit: annotated.coerce
        .number()
        .int()
        .min(1)
        .max(9)
        .default(5)
        .openapi({
          param: { name: "limit", in: "query", required: false },
          type: "integer",
          description: "how many",
        }),
    });

    expect(documentFor(z.object({}), ourParams, ourQuery)).toEqual(
      documentFor(annotated.object({}), theirParams, theirQuery),
    );
  });

  it("merges a second annotation over the first, and `.describe()` over both", () => {
    const ours = documentFor(
      z.object({
        chained: openapi(openapi(z.number(), { description: "one" }), { example: 3 }),
        described: openapi(z.string(), { description: "before" }).describe("after"),
        annotatedLast: openapi(z.string().describe("first"), { example: "z" }),
      }),
    );
    const theirs = documentFor(
      annotated.object({
        chained: annotated.number().openapi({ description: "one" }).openapi({ example: 3 }),
        described: annotated.string().openapi({ description: "before" }).describe("after"),
        annotatedLast: annotated.string().describe("first").openapi({ example: "z" }),
      }),
    );

    expect(ours).toEqual(theirs);
    expect(ours).toContain("after");
  });

  it("survives the modifiers applied after it — optional, default, nullable", () => {
    const ours = documentFor(
      z.object({
        opt: openapi(z.string(), { description: "opt" }).optional(),
        def: openapi(z.string(), { description: "def" }).default("d"),
        nul: openapi(z.string(), { description: "nul" }).nullable(),
      }),
    );
    const theirs = documentFor(
      annotated.object({
        opt: annotated.string().openapi({ description: "opt" }).optional(),
        def: annotated.string().openapi({ description: "def" }).default("d"),
        nul: annotated.string().openapi({ description: "nul" }).nullable(),
      }),
    );

    expect(ours).toEqual(theirs);
  });

  it("leaves the schema it was given unannotated, so a shared schema cannot be rewritten", () => {
    // CONTRACT-037's hazard in its other direction: naming a schema must not
    // reach back into the one it was derived from.
    const base = z.object({ a: z.string() });
    const named = openapi(base, "Named");

    expect(named).not.toBe(base);
    expect(documentFor(base)).not.toContain("Named");
    expect(documentFor(named)).toContain('"$ref": "#/components/schemas/Named"');
  });
});

const sourceRoot = join(import.meta.dirname, "..");

/** Every `.ts` module under `src/`, tests excluded. */
function sourceModules(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(path);
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
    return [path];
  });
}

describe("the OpenAPI extension of Zod", () => {
  /**
   * The saving CONTRACT-082 bought is exactly this: a consumer that builds no
   * routes and generates no document loads plain `zod` and stops there. One
   * schema module reaching for `@hono/zod-openapi` again puts `hono`,
   * `@hono/zod-validator` and `@asteasolutions/zod-to-openapi` back into every
   * `corpus` invocation, and nothing fails when it does — the tool is only
   * slower, for everyone.
   *
   * The rule is written as "whoever imports it builds routes" rather than as a
   * list of allowed files, so a new route module needs no edit here and a new
   * schema module cannot quietly join them.
   */
  it("is imported only by the modules that build routes or the document", () => {
    const offenders = sourceModules(sourceRoot)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      .filter(({ source }) => source.includes('from "@hono/zod-openapi"'))
      .filter(
        ({ source }) =>
          !/import \{[^}]*\b(createRoute|OpenAPIHono)\b[^}]*\} from "@hono\/zod-openapi"/s.test(
            source,
          ),
      )
      .map(({ path }) => relative(sourceRoot, path).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("is not imported by any schema module at all", () => {
    const schemas = sourceModules(join(sourceRoot, "schemas"))
      .filter((path) => readFileSync(path, "utf8").includes('from "@hono/zod-openapi"'))
      .map((path) => relative(sourceRoot, path).split(sep).join("/"));

    expect(schemas).toEqual([]);
  });
});
