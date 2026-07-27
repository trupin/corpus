import { describe, expect, it } from "vitest";
import { ACTOR_HEADER, ACTORS, DEFAULT_ACTOR } from "./actor.js";
import { BEARER_SECURITY_SCHEME, buildOpenApiDocument, CONTRACT_VERSION } from "./openapi.js";
import { ENDPOINT_INVENTORY, endpointSignature } from "./routes/inventory.js";
import { ALL_CONTRACT_ROUTES } from "./routes/index.js";

const document = buildOpenApiDocument();

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;
const MUTATING_METHODS = ["post", "put", "delete", "patch"] as const;

interface Operation {
  readonly summary?: string;
  readonly description?: string;
  readonly security?: unknown[];
  readonly parameters?: {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: { type?: string; enum?: string[]; default?: unknown };
  }[];
  readonly requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, unknown>;
  };
  readonly responses?: Record<string, { description?: string; content?: Record<string, unknown> }>;
}

/** `openapi3-ts` types the path item with an `any`-valued index signature. */
function operation(path: string, method: string): Operation {
  const item = document.paths?.[path] as Record<string, Operation> | undefined;
  const found = item?.[method];
  if (!found) throw new Error(`No ${method} ${path} in the generated document.`);
  return found;
}

function operations(): string[] {
  const found: string[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item && method in item) found.push(endpointSignature(method, path));
    }
  }
  return found.sort();
}

function parameter(path: string, method: string, name: string) {
  return operation(path, method).parameters?.find((entry) => entry.name === name);
}

/** The subset of JSON Schema the walk below needs; `openapi3-ts` types it as `any`. */
interface SchemaNode {
  readonly $ref?: string;
  readonly default?: unknown;
  readonly required?: string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
  readonly allOf?: SchemaNode[];
  readonly anyOf?: SchemaNode[];
  readonly oneOf?: SchemaNode[];
}

interface DefaultedProperty {
  readonly location: string;
  readonly required: boolean;
}

const componentSchemas = document.components?.schemas as Record<string, SchemaNode> | undefined;

function collectDefaults(
  node: SchemaNode | undefined,
  location: string,
  derefd: ReadonlySet<string>,
  found: DefaultedProperty[],
): void {
  if (!node) return;

  if (node.$ref !== undefined) {
    const name = node.$ref.split("/").pop() ?? "";
    // A component that refers back to itself (or a cycle through several) would
    // otherwise recurse forever; one visit per branch is enough to see it.
    if (derefd.has(name)) return;
    collectDefaults(
      componentSchemas?.[name],
      `${location} → ${name}`,
      new Set([...derefd, name]),
      found,
    );
    return;
  }

  const required = new Set(node.required ?? []);
  for (const [property, child] of Object.entries(node.properties ?? {})) {
    // `Object.hasOwn`, not a truthiness check: `default: null` is a default too.
    if (Object.hasOwn(child, "default")) {
      found.push({ location: `${location}.${property}`, required: required.has(property) });
    }
    collectDefaults(child, `${location}.${property}`, derefd, found);
  }

  for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    collectDefaults(branch, location, derefd, found);
  }
  collectDefaults(node.items, `${location}[]`, derefd, found);
}

/**
 * Every defaulted property reachable from any operation's request body,
 * resolving component references as it goes.
 *
 * The rule this feeds is stricter than "`required` and `default` never
 * overlap", and deliberately: `openapi-typescript` promotes *any* defaulted
 * property to a required member of the generated type, whatever the `required`
 * array says, so an omitted-from-`required` default still reaches the caller as
 * a mandatory field. Only a request surface with no defaults at all is safe —
 * hence optional-in, defaulted-out (`./schemas/index.ts`).
 */
function requestBodyDefaults(): DefaultedProperty[] {
  const found: DefaultedProperty[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, Operation> | undefined)?.[method];
      for (const [mediaType, media] of Object.entries(op?.requestBody?.content ?? {})) {
        const schema = (media as { schema?: SchemaNode }).schema;
        collectDefaults(
          schema,
          `${endpointSignature(method, path)} [${mediaType}]`,
          new Set(),
          found,
        );
      }
    }
  }
  return found;
}

describe("generated OpenAPI document", () => {
  it("is an OpenAPI 3.1 document stamped with the contract version", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe(CONTRACT_VERSION);
  });

  it("declares exactly the endpoints the pinned inventory names", () => {
    expect(operations()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  it("documents one operation per route definition", () => {
    expect(operations()).toHaveLength(ALL_CONTRACT_ROUTES.length);
  });

  it("requires the workspace bearer token by default", () => {
    expect(document.components?.securitySchemes?.[BEARER_SECURITY_SCHEME]).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(document.security).toEqual([{ [BEARER_SECURITY_SCHEME]: [] }]);
  });

  it.each([
    ["/api/health", "get"],
    ["/events", "get"],
    ["/api/jobs/{id}/log", "post"],
  ])("exempts %s %s from auth, as SPEC.md §2.1 and §7 allow", (path, method) => {
    expect(operation(path, method).security).toEqual([]);
  });

  it("declares 401 on every authenticated operation", () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op || op.security?.length === 0) continue;
        if (!op.responses?.["401"]) missing.push(endpointSignature(method, path));
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * `@hono/zod-openapi` validates every declared path parameter, query
   * parameter, header and body before the handler runs and answers `400` when
   * validation fails. An operation that takes validated input but does not
   * declare `400` therefore publishes an error union that cannot represent one
   * of its own real responses, and the generated client silently loses the
   * ability to narrow it.
   */
  it("declares 400 on every operation that validates request input", () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op) continue;
        const validatesInput = (op.parameters?.length ?? 0) > 0 || op.requestBody !== undefined;
        if (!validatesInput) continue;
        if (!op.responses?.["400"]) missing.push(endpointSignature(method, path));
      }
    }
    expect(missing).toEqual([]);
  });

  it("does not declare 400 on operations that take no request input", () => {
    const spurious: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op) continue;
        const validatesInput = (op.parameters?.length ?? 0) > 0 || op.requestBody !== undefined;
        if (!validatesInput && op.responses?.["400"]) {
          spurious.push(endpointSignature(method, path));
        }
      }
    }
    expect(spurious).toEqual([]);
  });

  /**
   * `internal_error` exists in the `ApiError` union so a server's last-resort
   * handler can serialise a crash without mislabelling it, and *only* for that.
   * Declaring `500` on a route would advertise an unexpected failure as a
   * designed outcome and hand clients a branch that no handler ever promises to
   * reach, so the response stays undeclared everywhere — deliberately.
   */
  it("declares 500 on no operation, since an unexpected failure is not contract surface", () => {
    const declared: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (op?.responses?.["500"]) declared.push(endpointSignature(method, path));
      }
    }
    expect(declared).toEqual([]);
    expect(Object.keys(document.components?.schemas ?? {})).not.toContain("InternalError");
  });

  it("documents the SSE stream as an event stream, not as JSON", () => {
    const ok = operation("/events", "get").responses?.["200"];
    expect(Object.keys(ok?.content ?? {})).toEqual(["text/event-stream"]);
  });

  /**
   * zod-to-openapi propagates a schema's registered name onto anything derived
   * from it, so `Named.nullable()` or `Named.default(x)` silently rewrites the
   * component definition. Resource components are always plain objects, so this
   * invariant catches that class of corruption before it reaches a client.
   */
  it("keeps every named component a plain, non-nullable, undefaulted object", () => {
    const corrupted = Object.entries(document.components?.schemas ?? {}).filter(
      ([, schema]) =>
        typeof schema !== "object" ||
        schema === null ||
        "$ref" in schema ||
        schema.type !== "object" ||
        schema.default !== undefined,
    );
    expect(corrupted.map(([name]) => name)).toEqual([]);
  });

  it("declares no server-applied default anywhere in a request body", () => {
    expect(requestBodyDefaults().map((entry) => entry.location)).toEqual([]);
  });

  it("lists no defaulted property in a request body's `required` array", () => {
    const contradictory = requestBodyDefaults().filter((entry) => entry.required);
    expect(contradictory.map((entry) => entry.location)).toEqual([]);
  });

  it("gives every operation a summary, so the document reads without the source", () => {
    const unsummarised: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (op && !op.summary) unsummarised.push(endpointSignature(method, path));
      }
    }
    expect(unsummarised).toEqual([]);
  });
});

/** SPEC.md §9.2's parameter list, in full and typed — the point of the collection query. */
describe("GET /api/docs parameter grammar", () => {
  const SPEC_PARAMS = [
    "q",
    "type",
    "status",
    "tag",
    "folder",
    "parent",
    "references",
    "agent",
    "author",
    "since",
    "due",
    "stale",
    "unread",
    "needs",
    "sort",
  ];

  it("declares every §9.2 parameter, plus CONTRACT-001's pagination, as optional query params", () => {
    const params = operation("/api/docs", "get").parameters ?? [];
    expect(params.map((entry) => entry.name)).toEqual(["limit", "offset", ...SPEC_PARAMS]);
    for (const entry of params) {
      expect(entry.in).toBe("query");
      expect(entry.required).toBe(false);
    }
  });

  it.each([
    ["status", ["open", "resolved", "archived"]],
    ["agent", ["none", "requested", "engaged"]],
    ["author", ["user", "agent"]],
    ["stale", ["aging", "stale", "very-stale"]],
    ["needs", ["me", "unread-reply", "form", "due", "stale", "failed-job"]],
    ["sort", ["updated", "-updated", "created", "-created", "due", "title", "relevance"]],
  ])("types %s as a strict enum", (name, values) => {
    expect(parameter("/api/docs", "get", name)?.schema?.enum).toEqual(values);
  });

  it("defaults sort to -updated", () => {
    expect(parameter("/api/docs", "get", "sort")?.schema?.default).toBe("-updated");
  });

  it("leaves `type` an open string, enumerating the core values in its description", () => {
    const param = parameter("/api/docs", "get", "type");
    expect(param?.schema?.type).toBe("string");
    expect(param?.schema?.enum).toBeUndefined();
    expect(param?.description).toContain("note, thread, view, template, skill, agent-def");
    expect(param?.description).toContain("plugins define their own");
  });

  it("types `unread` as a boolean rather than a string", () => {
    expect(parameter("/api/docs", "get", "unread")?.schema?.type).toBe("boolean");
  });

  it.each(["parent", "agent", "author", "unread"])(
    "documents that the thread-only filter %s no-ops for other types",
    (name) => {
      expect(parameter("/api/docs", "get", name)?.description).toContain("no-ops for non-thread");
    },
  );

  it("documents the archived-by-default exclusion and how to override it", () => {
    const description = parameter("/api/docs", "get", "status")?.description ?? "";
    expect(description).toContain("excludes");
    expect(description).toContain("archived");
    expect(description).toContain("overrides");
  });

  it("documents that relevance without a query is a 400, not a silent fallback", () => {
    expect(parameter("/api/docs", "get", "sort")?.description).toContain("`400`");
    expect(operation("/api/docs", "get").responses?.["400"]).toBeDefined();
  });
});

describe("author attribution", () => {
  it("declares the optional actor header on every mutating operation", () => {
    const problems: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op) continue;
        const header = op.parameters?.find(
          (entry) => entry.in === "header" && entry.name === ACTOR_HEADER,
        );
        const signature = endpointSignature(method, path);
        if (!header) problems.push(`${signature}: no ${ACTOR_HEADER}`);
        else if (header.required !== false) problems.push(`${signature}: header is required`);
        else if (header.schema?.enum?.join(",") !== ACTORS.join(",")) {
          problems.push(`${signature}: unexpected actor values`);
        } else if (!header.description?.includes(DEFAULT_ACTOR)) {
          problems.push(`${signature}: default not documented`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * The mechanism is uniform because several mutating routes are bodiless
   * (`DELETE`, `POST .../resolve`) or multipart, where a body field would be
   * impossible or inconsistent. So no request body may carry it either.
   */
  it("keeps the acting party out of every request body", () => {
    const schemas = document.components?.schemas ?? {};
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        for (const media of Object.values(op?.requestBody?.content ?? {})) {
          const ref = (media as { schema?: { $ref?: string } }).schema?.$ref;
          const name = ref?.split("/").pop();
          const properties =
            name === undefined
              ? undefined
              : (schemas[name] as { properties?: Record<string, unknown> } | undefined)?.properties;
          for (const field of ["author", "actor", "from"]) {
            if (properties && field in properties) {
              offenders.push(`${endpointSignature(method, path)} → ${name}.${field}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    ["/api/docs/{id}", "delete"],
    ["/api/threads/{id}/turns/{ts}", "delete"],
    ["/api/locks/{docId}/break", "post"],
  ])("declares 403 on the user-only route %s %s and says why", (path, method) => {
    const op = operation(path, method);
    expect(op.responses?.["403"]).toBeDefined();
    expect(op.description).toContain(`${ACTOR_HEADER}: agent`);
    expect(op.description).toContain("rejected");
  });
});

describe("deletion cascades are documented", () => {
  it("states the §6 turn-deletion cascade on the route", () => {
    const description = operation("/api/threads/{id}/turns/{ts}", "delete").description ?? "";
    expect(description).toContain("last");
    expect(description).toContain("anchor entry");
    expect(description).toContain("frontmatter");
  });

  it("states the §9.2 document-deletion cascade on the route", () => {
    const description = operation("/api/docs/{id}", "delete").description ?? "";
    expect(description).toContain("orphaned");
    expect(description).toContain("git");
  });

  it("tells clients to URL-encode the ISO timestamp path parameter", () => {
    const param = parameter("/api/threads/{id}/turns/{ts}", "delete", "ts");
    expect(param?.description).toContain("URL-encode");
  });

  it("says the id never changes on the move and archive routes", () => {
    for (const path of [
      "/api/docs/{id}/move",
      "/api/docs/{id}/archive",
      "/api/docs/{id}/unarchive",
    ]) {
      expect(operation(path, "post").description).toContain("id never changes");
    }
  });

  it("corrects the folder default to inbox everywhere it is documented", () => {
    const serialised = JSON.stringify(document);
    expect(serialised).not.toContain("defaults to the root");
    expect(serialised).toContain("Defaults to `inbox`");
    expect(serialised).toContain("data/docs/finance");
  });
});

describe("queue long-poll", () => {
  it("declares both outcomes, with the timeout bounded and defaulted", () => {
    const op = operation("/api/queue/idle", "get");
    expect(op.responses?.["200"]?.content).toBeDefined();
    expect(op.responses?.["204"]).toBeDefined();
    expect(op.responses?.["204"]?.content).toBeUndefined();
    const timeout = parameter("/api/queue/idle", "get", "timeout");
    expect(timeout?.schema?.default).toBe(480);
    expect(timeout?.description).toContain("clamps");
  });

  it("documents that a halted queue parks for the full window", () => {
    const description = operation("/api/queue/idle", "get").description ?? "";
    expect(description).toContain("halted");
    expect(description).toContain("never returns events");
  });
});

/**
 * Halt and fail both accept an annotation the caller may simply not have —
 * `corpus queue halt` with no argument stays a bare `POST`. They are the only
 * two operations whose body may be omitted in full, so they state
 * `required: false` rather than inheriting it from OpenAPI's default, and the
 * generated client turns that into an optional `requestBody`.
 */
describe("the annotatable queue verbs take an omittable body", () => {
  it.each([
    ["/api/queue/halt", "HaltQueueRequest"],
    ["/api/queue/{id}/fail", "FailEventRequest"],
  ])("declares %s's body optional and JSON-only", (path, component) => {
    const body = operation(path, "post").requestBody;
    expect(body?.required).toBe(false);
    expect(Object.keys(body?.content ?? {})).toEqual(["application/json"]);
    expect(JSON.stringify(body?.content)).toContain(`#/components/schemas/${component}`);
  });

  it.each(["HaltQueueRequest", "FailEventRequest"])(
    "leaves every property of %s optional, so the empty object satisfies it",
    (component) => {
      const schema = componentSchemas?.[component];
      expect(schema?.required).toBeUndefined();
      expect(Object.keys(schema?.properties ?? {})).toEqual(["reason"]);
    },
  );

  /**
   * Taking a body makes halt an input-validating operation, and
   * `@hono/zod-openapi` answers a bad one with a `400` — which the document must
   * therefore declare. The blanket invariant above already enforces this; naming
   * halt pins the specific regression the body introduced.
   */
  it("declares 400 on halt, now that halt validates a request body", () => {
    expect(operation("/api/queue/halt", "post").responses?.["400"]).toBeDefined();
  });

  it("says on the halt route that the body may be omitted entirely", () => {
    const op = operation("/api/queue/halt", "post");
    expect(op.description).toContain("body is optional in full");
    expect(op.requestBody?.description).toContain("omit the body entirely");
  });
});

describe("locks distinguish 409 from 423", () => {
  it("declares 409 carrying the existing lock on acquire, and never 423", () => {
    const op = operation("/api/locks/{docId}", "post");
    expect(op.responses?.["201"]).toBeDefined();
    expect(JSON.stringify(op.responses?.["409"])).toContain("LockConflictError");
    expect(op.responses?.["423"]).toBeUndefined();
  });

  it("declares 403 on release, since only the holder may release", () => {
    expect(operation("/api/locks/{docId}", "delete").responses?.["403"]).toBeDefined();
  });

  it.each([
    ["/api/docs/{id}", "put"],
    ["/api/docs/{id}", "delete"],
    ["/api/docs/{id}/move", "post"],
    ["/api/docs/{id}/archive", "post"],
    ["/api/docs/{id}/unarchive", "post"],
    ["/api/threads", "post"],
    ["/api/threads/{id}/turns/{ts}", "delete"],
  ])("declares 423 carrying the blocking lock on %s %s", (path, method) => {
    expect(JSON.stringify(operation(path, method).responses?.["423"])).toContain("LockedError");
  });
});

/** A blanket "all errors on every route" would defeat the point of a typed union. */
describe("routes declare only the codes they can return", () => {
  it("gives the unauthenticated health probe nothing but 200", () => {
    expect(Object.keys(operation("/api/health", "get").responses ?? {})).toEqual(["200"]);
  });

  it.each([
    ["/api/docs", "get"],
    ["/api/tree", "get"],
    ["/api/locks", "get"],
    ["/api/jobs", "get"],
    ["/api/jobs/{id}/log", "get"],
    ["/api/threads/{id}", "get"],
  ])("declares neither 409 nor 423 on the read-only route %s %s", (path, method) => {
    const responses = operation(path, method).responses ?? {};
    expect(responses["409"]).toBeUndefined();
    expect(responses["423"]).toBeUndefined();
  });

  it.each([
    ["/api/docs", "get"],
    ["/api/tree", "get"],
    ["/api/threads/{id}", "get"],
  ])("declares no 403 on the read-only route %s %s", (path, method) => {
    expect(operation(path, method).responses?.["403"]).toBeUndefined();
  });
});

describe("multipart, attachments and the stream", () => {
  it("offers both a JSON and a multipart body on turn-append", () => {
    const content = operation("/api/threads/{id}/turns", "post").requestBody?.content ?? {};
    expect(Object.keys(content)).toEqual(["application/json", "multipart/form-data"]);
  });

  it("declares capture as multipart only", () => {
    const content = operation("/api/capture", "post").requestBody?.content ?? {};
    expect(Object.keys(content)).toEqual(["multipart/form-data"]);
  });

  it("types the attached files as an array of binaries", () => {
    const schemas = document.components?.schemas ?? {};
    for (const name of ["MultipartAppendTurnRequest", "CaptureRequest"]) {
      const files = (schemas[name] as { properties?: Record<string, unknown> } | undefined)
        ?.properties?.["files"];
      expect(files).toMatchObject({ type: "array", items: { type: "string", format: "binary" } });
    }
  });

  it("declares the attachment route as binary bytes", () => {
    const content = operation("/attachments/{path}", "get").responses?.["200"]?.content ?? {};
    expect(Object.keys(content)).toEqual(["application/octet-stream"]);
    expect(JSON.stringify(content)).toContain('"format":"binary"');
  });

  it("documents the SSE heartbeat, subscriber pruning and token parameter", () => {
    const op = operation("/events", "get");
    expect(op.description).toContain("25 s heartbeat");
    expect(op.description).toContain("dead subscribers pruned");
    expect(parameter("/events", "get", "token")?.in).toBe("query");
    expect(parameter("/events", "get", "token")?.description).toContain("EventSource cannot set");
  });

  it("describes the job-log ingest as loopback-only and tokenless", () => {
    const description = operation("/api/jobs/{id}/log", "post").description ?? "";
    expect(description).toContain("Localhost-only");
    expect(description).toContain("unauthenticated");
  });
});
