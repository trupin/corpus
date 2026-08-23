import type { z } from "zod";

/**
 * OpenAPI annotation for a Zod schema, written without loading the OpenAPI
 * extension of Zod (CONTRACT-082).
 *
 * ## Why this exists at all
 *
 * `@hono/zod-openapi` re-exports a `z` whose `ZodType.prototype` has been
 * patched with an `.openapi()` method. Importing that `z` therefore drags in
 * `hono`, `@hono/zod-validator` and `@asteasolutions/zod-to-openapi` — **18.4 ms
 * on top of plain `zod`**, measured by CLI-058 on the packaged bundle. Every
 * `corpus` invocation paid it, for an annotation no client ever reads: the CLI
 * serves no routes and generates no document. The agent loop is made of hundreds
 * of invocations, so that is a real budget.
 *
 * So `src/schemas/*.ts` import `z` from `zod`, and say what they would have said
 * with `.openapi(…)` by calling {@link openapi} instead. A consumer that only
 * parses wire shapes loads Zod and nothing else.
 *
 * ## How it can be equivalent
 *
 * `.openapi()` stores its payload in a registry private to
 * `@asteasolutions/zod-to-openapi`. The generator reads that registry through
 * `Metadata.getMetadataFromRegistry`, which merges it over **Zod's own**
 * `globalRegistry` — the one `.meta()` and `.describe()` write to — and falls
 * back to it entirely when the private registry has no entry for a schema. So a
 * `.meta()` payload carrying the same keys, including the `_internal` envelope
 * that holds the component name, reaches the generator by exactly the path a
 * `.openapi()` payload does.
 *
 * That is a real coupling to a library internal, and the honest guard is the
 * artifact rather than the reasoning: `openapi.json` regenerates byte-identical,
 * and `openapi.test.ts` asserts the published prose, the components and the
 * parameters it contains. If a future `zod-to-openapi` stops consulting Zod's
 * registry, the generated document changes and the drift check says so.
 *
 * ## What is not here
 *
 * `.openapi()` also patches `.optional()`, `.nullable()` and — on an annotated
 * object — `.extend()`, so a modifier applied after an annotation carries the
 * metadata onto the wrapper. Nothing is lost by skipping that: the generator
 * unwraps optional, nullable, default and readonly and collects the inner
 * schema's metadata anyway, and no annotated object in this package is
 * `.extend()`-ed. `z.lazy` gets its own special case upstream and this package
 * has none (see the note in `tree.ts`).
 */

/** An OpenAPI parameter binding, as `.openapi({ param })` takes it. */
export interface OpenApiParameterMetadata {
  readonly name: string;
  readonly in: "query" | "path" | "header" | "cookie";
  readonly required?: boolean;
}

/**
 * The annotation payload, which is a **subset** of `zod-to-openapi`'s
 * `ZodOpenAPIMetadata` — the keys this contract actually publishes, spelled out
 * rather than borrowed so nothing here depends on a package `@corpus/contract`
 * does not declare. Adding a key is a deliberate one-line edit; the generator
 * passes through whatever it is given.
 */
export interface OpenApiMetadata {
  readonly description?: string;
  readonly example?: unknown;
  readonly examples?: readonly unknown[];
  readonly default?: unknown;
  readonly type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: Readonly<Record<string, unknown>>;
  readonly param?: OpenApiParameterMetadata;
}

/**
 * The envelope `zod-to-openapi` reads the component name out of. Private to the
 * generator, and never emitted into a schema — `Metadata.buildSchemaMetadata`
 * strips it.
 */
interface InternalMetadata {
  readonly refId?: string;
}

interface StoredMetadata extends OpenApiMetadata {
  readonly _internal?: InternalMetadata;
}

/**
 * Registers `schema` as an OpenAPI component named `refId`, so every reference
 * to it publishes a `$ref` and the shape is written once.
 *
 * **Never name a schema derived from a named one.** `X.nullable()` and friends
 * inherit the name, which rewrites the shared component for every route that
 * references it (CONTRACT-037). The safe spelling of a nullable reference is
 * `z.union([X, z.null()])`.
 */
export function openapi<T extends z.ZodType>(
  schema: T,
  refId: string,
  metadata?: OpenApiMetadata,
): T;
/** Annotates `schema` in place in the document — a description, an example, a parameter binding. */
export function openapi<T extends z.ZodType>(schema: T, metadata: OpenApiMetadata): T;
export function openapi<T extends z.ZodType>(
  schema: T,
  refIdOrMetadata: string | OpenApiMetadata,
  maybeMetadata?: OpenApiMetadata,
): T {
  const refId = typeof refIdOrMetadata === "string" ? refIdOrMetadata : undefined;
  const metadata = typeof refIdOrMetadata === "string" ? maybeMetadata : refIdOrMetadata;

  const { param, ...rest } = metadata ?? {};
  // Zod types its own registry as an open record of `unknown`, so the shape this
  // function is the only writer of has to be asserted rather than inferred.
  const {
    _internal: currentInternal,
    param: currentParam,
    ...currentRest
  } = (schema.meta() ?? {}) as StoredMetadata;

  // Mirrors `.openapi()`'s own merge: later keys win, `param` merges one level
  // deep, and the internal envelope is only written when it has something in it.
  const internal: InternalMetadata = {
    ...currentInternal,
    ...(refId === undefined ? {} : { refId }),
  };

  return schema.meta({
    ...(Object.keys(internal).length > 0 ? { _internal: internal } : {}),
    ...currentRest,
    ...rest,
    ...(currentParam === undefined && param === undefined
      ? {}
      : { param: { ...currentParam, ...param } }),
  });
}
