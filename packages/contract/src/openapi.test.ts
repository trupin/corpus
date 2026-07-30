import { describe, expect, it } from "vitest";
import { ACTOR_HEADER, ACTORS, DEFAULT_ACTOR } from "./actor.js";
import { BEARER_SECURITY_SCHEME, buildOpenApiDocument, CONTRACT_VERSION } from "./openapi.js";
import { CHECK_CODES, CHECK_WARNING_CODES } from "./schemas/check.js";
import { DRIFT_KINDS, PROJECTION_COUNT_FIELDS } from "./schemas/db.js";
import { ERROR_CODES } from "./schemas/error.js";
import { EXTRA_MAX_BYTES, EXTRA_MAX_DEPTH, RESERVED_FRONTMATTER_KEYS } from "./schemas/extra.js";
import { ENDPOINT_INVENTORY, endpointSignature } from "./routes/inventory.js";
import { ALL_CONTRACT_ROUTES } from "./routes/index.js";
import { QUERY_KEY_NAMES, QUERY_KEY_VOCABULARY } from "./query-keys.js";

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
  readonly type?: string;
  readonly enum?: string[];
  readonly default?: unknown;
  readonly minimum?: number;
  readonly required?: string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
  readonly allOf?: SchemaNode[];
  readonly anyOf?: SchemaNode[];
  readonly oneOf?: SchemaNode[];
  readonly additionalProperties?: boolean | SchemaNode;
  readonly description?: string;
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
   * A client author reading only the generated document must learn the whole
   * closed key vocabulary from it — which shapes exist, what emits each, and
   * what refetches on it. Publishing the constants is half the job; this is the
   * half that survives someone who never opens the package.
   */
  it("carries the whole query-key vocabulary in the SSE stream's description", () => {
    const description = operation("/events", "get").description ?? "";
    for (const name of QUERY_KEY_NAMES) {
      const entry = QUERY_KEY_VOCABULARY[name];
      expect(description, `${name}.shape`).toContain(entry.shape);
      expect(description, `${name}.emittedBy`).toContain(entry.emittedBy);
      expect(description, `${name}.refetchedBy`).toContain(entry.refetchedBy);
    }
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
    // CONTRACT-012's rider, declared beside the default it lifts.
    "includeArchived",
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
    "pinned",
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
    ["sort", ["updated", "-updated", "created", "-created", "due", "title", "order", "relevance"]],
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

  it("types `pinned` as a boolean and points it at the board's one column-set query", () => {
    const param = parameter("/api/docs", "get", "pinned");
    expect(param?.schema?.type).toBe("boolean");
    expect(param?.description).toContain("pinned=true&type=view&sort=order");
  });

  it("documents the order sort's full tiebreak, so column order is deterministic everywhere", () => {
    const description = parameter("/api/docs", "get", "sort")?.description ?? "";
    expect(description).toContain("nulls last");
    expect(description).toContain("`title`");
    expect(description).toContain("`id`");
    expect(description).toContain("never dropped");
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

  /**
   * CONTRACT-012's rider. `status` takes one lifecycle value, so it can express
   * "archived only" and never "archived as well". The two parameters have to
   * publish that distinction, because a chip labelled "include archived" that
   * returns *only* archived documents is the failure this pair prevents.
   */
  it("types `includeArchived` as a boolean that widens the default rather than replacing it", () => {
    const param = parameter("/api/docs", "get", "includeArchived");
    expect(param?.schema?.type).toBe("boolean");
    expect(param?.schema?.default).toBeUndefined();
    expect(param?.description).toContain("union");
    expect(param?.description).toContain("no-op alongside an explicit `status`");
  });

  it("keeps `status=archived` meaning archived-only, and says where the union lives", () => {
    expect(parameter("/api/docs", "get", "status")?.description).toContain("includeArchived=true");
    expect(parameter("/api/docs", "get", "includeArchived")?.description).toContain(
      "`status=archived` selects archived",
    );
  });

  it("documents that relevance without a query is a 400, not a silent fallback", () => {
    expect(parameter("/api/docs", "get", "sort")?.description).toContain("`400`");
    expect(operation("/api/docs", "get").responses?.["400"]).toBeDefined();
  });
});

/**
 * CONTRACT-011: the extra-frontmatter surface and the first-class §11 view
 * keys. The schema descriptions here ARE the plugin contract — a plugin author
 * reads only the generated document — so these invariants pin the published
 * prose, not just the shapes.
 */
describe("the extra-frontmatter surface (CONTRACT-011)", () => {
  const VIEW_AND_EXTRA_KEYS = ["pinned", "order", "query", "column", "extra"];

  function component(name: string): SchemaNode {
    const found = componentSchemas?.[name];
    if (!found) throw new Error(`No ${name} component in the generated document.`);
    return found;
  }

  it.each(["DocFrontmatter", "DocRow"])(
    "carries the view keys and extra on %s, required — the board reads its columns in one list call",
    (name) => {
      const schema = component(name);
      for (const key of VIEW_AND_EXTRA_KEYS) {
        expect(schema.properties?.[key], `${name}.${key}`).toBeDefined();
        expect(schema.required, `${name}.${key} must be required`).toContain(key);
      }
    },
  );

  it.each(["CreateDocRequest", "UpdateDocRequest"])(
    "accepts the view keys and extra on %s without ever demanding them",
    (name) => {
      const schema = component(name);
      for (const key of VIEW_AND_EXTRA_KEYS) {
        expect(schema.properties?.[key], `${name}.${key}`).toBeDefined();
        expect(schema.required ?? [], `${name}.${key} must stay optional`).not.toContain(key);
      }
    },
  );

  it.each(["DocFrontmatter", "DocRow", "CreateDocRequest", "UpdateDocRequest"])(
    "publishes the whole extra contract on %s: the reserved keys, the bounds, the merge patch",
    (name) => {
      const description = JSON.stringify(component(name).properties?.["extra"]);
      for (const key of RESERVED_FRONTMATTER_KEYS) {
        expect(description, `reserved key ${key}`).toContain(key);
      }
      expect(description).toContain("never interprets");
      expect(description).toContain("merge patch");
      expect(description).toContain("removes it");
      expect(description).toContain(`${String(EXTRA_MAX_DEPTH)} containers deep`);
      expect(description).toContain(String(EXTRA_MAX_BYTES));
    },
  );

  it("keeps extra an object of free values — the server never types a plugin's keys", () => {
    for (const name of ["DocFrontmatter", "DocRow"]) {
      expect(component(name).properties?.["extra"]?.type).toBe("object");
    }
  });

  it("documents that the stored view query is client-compiled, never server-interpreted", () => {
    const description = JSON.stringify(component("DocFrontmatter").properties?.["query"]);
    expect(description).toContain("never interprets it");
    expect(description).toContain("degrades in the client");
  });

  it("publishes the column reference format where a plugin author will look", () => {
    const description = JSON.stringify(component("DocFrontmatter").properties?.["column"]);
    expect(description).toContain("<plugin>/<type>");
    expect(description).toContain("plugin-missing");
  });

  it("states the null-clears rule on every clearable update field", () => {
    for (const key of ["order", "query", "column"]) {
      expect(
        JSON.stringify(component("UpdateDocRequest").properties?.[key]),
        `UpdateDocRequest.${key}`,
      ).toContain("clears the key");
    }
  });

  it("gives DocRow a nullable parent title with Job.originTitle's one-sentence rule", () => {
    const row = component("DocRow");
    expect(row.required).toContain("parentTitle");
    const property = JSON.stringify(row.properties?.["parentTitle"]);
    expect(property).toContain('"null"');
    expect(property).toContain("current title of whatever `parent` names");
    expect(property).toContain("never a stored copy");
  });

  /**
   * CONTRACT-012's rider. The published prose has to distinguish an orphaned
   * thread (`parent` set, title gone → an empty context cell) from a standalone
   * one (`parent` null): the kit's `rowContext` renders only the second as the
   * word "standalone", and the description used to promise the opposite.
   */
  it("does not tell a client to render an orphaned thread as standalone", () => {
    const property = JSON.stringify(component("DocRow").properties?.["parentTitle"]);
    expect(property).toContain("empty");
    expect(property).not.toContain("render such a thread as standalone");
  });
});

/**
 * CONTRACT-012. The aggregate that lets a document row render its unread pill
 * from the collection response alone. The description is the whole contract
 * SERVER-027 implements against, so it is pinned here rather than only inferred
 * from the type.
 */
describe("DocRow.unreadThreads (CONTRACT-012)", () => {
  const property = () => componentSchemas?.["DocRow"]?.properties?.["unreadThreads"];

  it("is a required, non-negative integer — never nullable, never absent", () => {
    expect(componentSchemas?.["DocRow"]?.required).toContain("unreadThreads");
    expect(property()?.type).toBe("integer");
    expect(property()?.minimum).toBe(0);
    expect(JSON.stringify(property())).not.toContain('"null"');
  });

  it("publishes what it counts, the thread-row case, and that 0 is not `unknown`", () => {
    const description = JSON.stringify(property());
    expect(description).toContain("SPEC.md §7");
    expect(description).toContain("?parent=<id>&type=thread&unread=true");
    expect(description).toContain("`0` on a thread row");
    expect(description).toContain("no threads");
    expect(description).toContain("unknown");
  });

  /**
   * The aggregate and the per-thread flag must be two readings of one rule, or
   * a row's pill and the thread list behind it disagree.
   */
  it("ties itself to the per-thread `unread` flag rather than defining a second rule", () => {
    expect(JSON.stringify(property())).toContain("per-thread `unread` flag");
    expect(componentSchemas?.["DocRow"]?.required).toContain("unread");
  });
});

describe("author attribution", () => {
  /**
   * `POST` because a request body is the only way to say what to check, not
   * because anything is written: `/api/check` runs the validator and mutates
   * nothing, so there is no git author to attribute and no header to carry one
   * (SPEC.md §14). Declaring one would advertise a write that never happens.
   */
  const READ_ONLY_POSTS = new Set(["POST /api/check"]);

  it("declares the optional actor header on every mutating operation", () => {
    const problems: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op || READ_ONLY_POSTS.has(endpointSignature(method, path))) continue;
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
    expect(timeout?.description).toContain("400 validation error, not clamped");
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
    // A skill is an ordinary document; its rollback rewrites the file
    // (CONTRACT-018), so it refuses under the other party's lock like the rest.
    ["/api/skills/{name}/rollback", "post"],
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

/**
 * CONTRACT-008. The validation surface §14 requires ("`corpus doc check` exposes
 * the same validator on demand") and the loop-safety revert §7 requires
 * ("`corpus skill rollback <name>` — a targeted git revert, performed by the
 * server"). No handler serves either yet: SERVER-019 registers against exactly
 * these definitions, so what is pinned here is the shape it inherits.
 */
describe("the validation and skill-rollback surface", () => {
  const CHECK_PATH = "/api/check";
  const ROLLBACK_PATH = "/api/skills/{name}/rollback";

  it("adds exactly two endpoints to the inventory", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/check");
    expect(ENDPOINT_INVENTORY).toContain("POST /api/skills/{name}/rollback");
  });

  /** Both are ordinary authenticated routes: neither joins the §2.1 exception list. */
  it.each([CHECK_PATH, ROLLBACK_PATH])("requires the workspace bearer token on %s", (path) => {
    expect(operation(path, "post").security).toBeUndefined();
    expect(operation(path, "post").responses?.["401"]).toBeDefined();
  });

  it("declares only the codes a check can produce", () => {
    expect(Object.keys(operation(CHECK_PATH, "post").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
    ]);
  });

  it("declares only the codes a rollback can produce", () => {
    expect(Object.keys(operation(ROLLBACK_PATH, "post").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "404",
      "423",
    ]);
  });

  describe("the check request", () => {
    function requestSchema(): SchemaNode {
      const media = operation(CHECK_PATH, "post").requestBody?.content?.["application/json"];
      return (media as { schema: SchemaNode }).schema;
    }

    /**
     * The XOR is in the document, not in a handler: two closed branches, so a
     * body naming both keys matches neither and a body naming neither matches
     * neither. `routes/check.test.ts` proves the validator enforces it.
     */
    it("publishes ids and content pairs as two closed alternatives", () => {
      const branches = requestSchema().anyOf ?? [];
      expect(branches).toHaveLength(2);
      expect(branches.map((branch) => branch.required)).toEqual([["ids"], ["documents"]]);
      expect(
        branches.every(
          (branch) => (branch as { additionalProperties?: unknown }).additionalProperties === false,
        ),
      ).toBe(true);
    });

    /** `toCheckDocument(path, raw)`'s argument list, field for field. */
    it("shapes the content pair as (path, content) and nothing else", () => {
      const pair = componentSchemas?.["CheckDocumentInput"];
      expect(Object.keys(pair?.properties ?? {})).toEqual(["path", "content"]);
      expect(pair?.required).toEqual(["path", "content"]);
    });

    it("says an empty collection is a real call, not an implicit everything", () => {
      const description = operation(CHECK_PATH, "post").description ?? "";
      expect(description).toContain("empty");
      expect(description).toContain("no implicit everything form");
    });
  });

  describe("the check report", () => {
    it("reuses CheckFinding's field names verbatim", () => {
      expect(Object.keys(componentSchemas?.["CheckFinding"]?.properties ?? {})).toEqual([
        "code",
        "severity",
        "docId",
        "path",
        "detail",
      ]);
    });

    it("separates the exit-6 class from the reportable one", () => {
      const report = componentSchemas?.["CheckReport"];
      expect(Object.keys(report?.properties ?? {})).toEqual(["ok", "errors", "warnings"]);
      expect(report?.required).toEqual(["ok", "errors", "warnings"]);
      expect(report?.properties?.["ok"]?.description).toContain("errors` is empty");
    });

    /**
     * The published enum is the validator's, and the route says which two of it
     * are warnings — the one fact a consumer cannot read off the enum itself.
     */
    it("publishes the closed thirteen-code vocabulary", () => {
      expect(componentSchemas?.["CheckFinding"]?.properties?.["code"]?.enum).toEqual([
        ...CHECK_CODES,
      ]);
      expect(CHECK_CODES).toHaveLength(13);
    });

    it("records the two warning codes, and only those, in the route description", () => {
      const description = operation(CHECK_PATH, "post").description ?? "";
      for (const code of CHECK_WARNING_CODES) expect(description, code).toContain(code);
      expect(description).toContain("The other eleven codes are errors");
      expect(description).toContain("`anchor-unused` among them");
    });

    it("leaves docId an unvalidated nullable string, since a bad id is a finding", () => {
      expect(componentSchemas?.["CheckFinding"]?.properties?.["docId"]).toMatchObject({
        type: ["string", "null"],
      });
    });
  });

  /**
   * The check writes nothing, so there is no git author to attribute — and no
   * §14 commit warning it could ever produce. Both absences are asserted, not
   * merely intended.
   */
  describe("the check is read-only and says so", () => {
    it("declares no acting party", () => {
      const parameters = operation(CHECK_PATH, "post").parameters ?? [];
      expect(parameters.filter((entry) => entry.in === "header")).toEqual([]);
    });

    it("states that it exposes the write path's own validator", () => {
      const description = operation(CHECK_PATH, "post").description ?? "";
      expect(description).toContain("same validator every server mutation runs before writing");
      expect(description).toContain("hooks and API share one implementation");
    });
  });

  describe("the rollback", () => {
    it("names the skill in the path, as every other resource route does", () => {
      const parameters = operation(ROLLBACK_PATH, "post").parameters ?? [];
      expect(parameters.filter((entry) => entry.in === "path").map((entry) => entry.name)).toEqual([
        "name",
      ]);
      expect(componentSchemas?.["SkillRollbackRequest"]?.properties?.["name"]).toBeUndefined();
    });

    it("carries the acting party, since the revert is an auto-commit", () => {
      const header = operation(ROLLBACK_PATH, "post").parameters?.find(
        (entry) => entry.in === "header" && entry.name === ACTOR_HEADER,
      );
      expect(header?.required).toBe(false);
      expect(operation(ROLLBACK_PATH, "post").description).toContain("normal auto-commit");
    });

    it("takes an optional revision and nothing else", () => {
      expect(Object.keys(componentSchemas?.["SkillRollbackRequest"]?.properties ?? {})).toEqual([
        "to",
      ]);
      expect(componentSchemas?.["SkillRollbackRequest"]?.required).toBeUndefined();
    });

    it("returns the restored commit and path, plus the skill's name and id", () => {
      const result = componentSchemas?.["SkillRollbackResult"];
      expect(Object.keys(result?.properties ?? {})).toEqual([
        "name",
        "docId",
        "commit",
        "path",
        "warnings",
      ]);
      for (const field of ["name", "docId", "commit", "path"] as const) {
        expect(result?.properties?.[field]?.description, field).toBeTruthy();
      }
    });

    /**
     * CONTRACT-016. §14 keeps the file write when the auto-commit is rejected,
     * so the response has to be able to say "restored, uncommitted". A
     * non-nullable `commit` made that outcome undescribable on the wire, and the
     * available shortcut — echoing the pre-existing HEAD — would have written a
     * commit that is not this restoration into the field the audit trail reads.
     */
    it("lets `commit` be null, since §14 keeps the write when the commit fails", () => {
      const commit = componentSchemas?.["SkillRollbackResult"]?.properties?.["commit"];
      expect(commit).toMatchObject({ type: ["string", "null"], pattern: "^[0-9a-f]{7,64}$" });
      expect(commit?.description).toContain("`null` means the file was restored but not committed");
      expect(commit?.description).toContain("the file write stands regardless (SPEC.md §14)");
      expect(commit?.description).toContain("is in `warnings`");
    });

    it("keeps `commit` required — nullable is not optional", () => {
      expect(componentSchemas?.["SkillRollbackResult"]?.required).toContain("commit");
    });

    it("states the null outcome in the route's own prose, not only in the schema", () => {
      expect(operation(ROLLBACK_PATH, "post").description).toContain(
        "the file is restored anyway, `commit` is `null`",
      );
      expect(
        JSON.stringify(operation(ROLLBACK_PATH, "post").responses?.["200"]?.description),
      ).toContain("or `null` when that commit failed or was skipped");
    });

    it("uses the shipped 404 envelope and states the condition", () => {
      expect(JSON.stringify(operation(ROLLBACK_PATH, "post").responses?.["404"])).toContain(
        "NotFoundError",
      );
      expect(componentSchemas?.["NotFoundError"]?.properties?.["code"]?.enum).toEqual([
        "not_found",
      ]);
      expect(operation(ROLLBACK_PATH, "post").description).toContain(
        "no skill of that name is installed",
      );
    });
  });
});

/**
 * CONTRACT-006. §14's "a warning on the API response" has to be true of every
 * mutation, not only of the document ones: thread writes go through the same
 * server pipeline, and anchored creation writes the **parent document's**
 * frontmatter. A shape that cannot carry a warning makes §14 selectively true.
 */
describe("§14 warnings reach every mutation response", () => {
  const CARRIERS = [
    "DocMutationResponse",
    "UpdateDocResponse",
    "DeleteDocResult",
    "CreateThreadResponse",
    "AppendTurnResponse",
    "CaptureResult",
    "DeleteTurnResult",
    // CONTRACT-007: resolve/reopen used to return a bare `ThreadSummary`, so the
    // warnings the server already computed for them could only be logged.
    "ThreadMutationResponse",
    "FormAnswerResponse",
    // CONTRACT-008: a skill rollback is a git revert the server performs and
    // auto-commits (§7), so the workspace's hooks can reject it exactly as they
    // can reject any other write.
    "SkillRollbackResult",
  ];

  /**
   * Components whose `warnings` is a different vocabulary and must not be held
   * to `Warning`'s shape. `CheckReport.warnings` is the **validator's** severity
   * split — §14's "unresolvable-but-well-formed anchors and unresolved
   * `[[refs]]` are warnings, not failures" — carrying `CheckFinding`s.
   * `/api/check` writes nothing and can produce no commit warning at all, so
   * there is no shape here for `Warning` to occupy.
   */
  const FOREIGN_WARNINGS = ["CheckReport"];

  it.each(CARRIERS)("declares `warnings` required on %s", (component) => {
    const schema = componentSchemas?.[component];
    expect(schema?.required).toContain("warnings");
    expect(schema?.properties?.["warnings"]).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/Warning" },
    });
  });

  /**
   * Pinned from the other side too: a mutation response added later without the
   * field shows up here as an unlisted carrier rather than passing unnoticed.
   */
  it("finds no other component carrying a differently-shaped warnings field", () => {
    const stray = Object.entries(componentSchemas ?? {})
      .filter(([name]) => !CARRIERS.includes(name) && !FOREIGN_WARNINGS.includes(name))
      .filter(([, schema]) => schema.properties?.["warnings"] !== undefined);
    expect(stray.map(([name]) => name)).toEqual([]);
  });

  it("keeps the check report's warnings a findings list, not a commit-warning list", () => {
    expect(componentSchemas?.["CheckReport"]?.properties?.["warnings"]).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/CheckFinding" },
    });
  });
});

/**
 * CONTRACT-007. The forms surface (SPEC.md §6) and the three riders that shipped
 * with it, each pinned from the side a careless later edit would break.
 */
describe("the forms surface", () => {
  const FORM_PATH = "/api/threads/{id}/turns/{ts}/form";

  it("addresses the form through the turn that carries it", () => {
    const params = operation(FORM_PATH, "post").parameters ?? [];
    const path = params.filter((entry) => entry.in === "path").map((entry) => entry.name);
    expect(path).toEqual(["id", "ts"]);
  });

  it("tells clients to URL-encode the form's ISO timestamp", () => {
    expect(parameter(FORM_PATH, "post", "ts")?.description).toContain("URL-encode");
  });

  /**
   * The whole grammar §6 leaves unspecified is published on the route, because
   * the detector, the write path and the UI all read it from the document rather
   * than from three private assumptions.
   */
  it("publishes the fence grammar it validates answers against", () => {
    const description = operation(FORM_PATH, "post").description ?? "";
    for (const phrase of [
      "info string is exactly `form`",
      "prompt",
      "options",
      "distinct",
      "single",
      "verbatim",
      "form.respond",
    ]) {
      expect(description, phrase).toContain(phrase);
    }
  });

  it("says a rejected option is a 400 naming the offending field", () => {
    const op = operation(FORM_PATH, "post");
    expect(op.description).toContain("body.option");
    expect(op.responses?.["400"]).toBeDefined();
  });

  it("declares only the codes an answer can produce", () => {
    expect(Object.keys(operation(FORM_PATH, "post").responses ?? {})).toEqual([
      "201",
      "400",
      "401",
      "404",
    ]);
  });

  it("keeps the answer body to the answer", () => {
    expect(Object.keys(componentSchemas?.["FormAnswerRequest"]?.properties ?? {})).toEqual([
      "option",
      "note",
    ]);
    expect(componentSchemas?.["FormAnswerRequest"]?.required).toEqual(["option"]);
  });

  /** Nullable, not optional — a resolved thread stops re-triggering the agent (§8). */
  it("always carries the enqueued event key on the answer response", () => {
    expect(componentSchemas?.["FormAnswerResponse"]?.required).toEqual([
      "thread",
      "turn",
      "eventId",
      "warnings",
    ]);
  });

  /**
   * §7 keeps the event `type` open so plugins can define their own; a payload
   * union keyed on `type` would close it. The core payload is documented on the
   * envelope instead.
   */
  it("leaves the queue event payload open while naming the core form payload", () => {
    const payload = componentSchemas?.["QueueEvent"]?.properties?.["payload"];
    expect(payload?.type).toBe("object");
    expect(payload?.enum).toBeUndefined();
    const description = JSON.stringify(componentSchemas?.["QueueEvent"]);
    expect(description).toContain("form.respond");
    expect(description).toContain("{threadId, formTs, option, note}");
  });
});

describe("the CONTRACT-007 riders", () => {
  it("returns both halves of a reap, and requires both", () => {
    const schema = componentSchemas?.["ReapStaleResult"];
    expect(schema?.required).toEqual(["reaped", "failed"]);
    expect(schema?.properties?.["failed"]?.type).toBe("array");
  });

  it("wraps resolve and reopen rather than putting warnings on the resource", () => {
    for (const path of ["/api/threads/{id}/resolve", "/api/threads/{id}/reopen"]) {
      expect(JSON.stringify(operation(path, "post").responses?.["200"])).toContain(
        "ThreadMutationResponse",
      );
    }
    expect(componentSchemas?.["ThreadMutationResponse"]?.required).toEqual(["thread", "warnings"]);
    expect(componentSchemas?.["ThreadSummary"]?.properties?.["warnings"]).toBeUndefined();
  });

  it("gives Job a nullable origin title without making the component nullable", () => {
    const job = componentSchemas?.["Job"];
    expect(job?.type).toBe("object");
    expect(job?.required).toEqual([
      "eventId",
      "type",
      "status",
      "started",
      "updated",
      "lastLine",
      "originId",
      "originTitle",
    ]);
    expect(JSON.stringify(job?.properties?.["originTitle"])).toContain('"null"');
  });

  it("states the origin title's rule in one sentence, for the server and the console", () => {
    const description = JSON.stringify(componentSchemas?.["Job"]?.properties?.["originTitle"]);
    expect(description).toContain("current title of whatever `originId` names, or null");
  });

  /**
   * CONTRACT-012's rider. The console row is `<event type> · <title>`; without
   * `type` the console can only say what a job is running *on*. It stays an
   * open string for the same reason `QueueEvent.type` does.
   */
  it("gives Job the event type as an open string, matching QueueEvent", () => {
    const property = componentSchemas?.["Job"]?.properties?.["type"];
    expect(property?.type).toBe("string");
    expect(property?.enum).toBeUndefined();
    const description = JSON.stringify(property);
    expect(description).toContain("comment.created, form.respond, agent.done");
    expect(description).toContain("plugins define");
    expect(description).toContain("QueueEvent.type");
  });
});

/**
 * SPEC.md §2.2 and §14's projection-maintenance pair. `rebuild && doctor` clean
 * is the standing invariant v1's definition of done gates on, so both halves are
 * contract surface rather than server-local commands.
 */
describe("the projection maintenance routes", () => {
  it("takes no request input at all on the rebuild, beyond the actor header", () => {
    const op = operation("/api/db/rebuild", "post");
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters?.map((entry) => entry.name)).toEqual([ACTOR_HEADER]);
  });

  it("takes no request input at all on doctor, and therefore declares no 400", () => {
    const op = operation("/api/db/doctor", "get");
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters).toBeUndefined();
    expect(Object.keys(op.responses ?? {})).toEqual(["200", "401"]);
  });

  it.each([
    ["/api/db/rebuild", "post"],
    ["/api/db/doctor", "get"],
  ])("keeps %s %s behind the bearer token", (path, method) => {
    expect(operation(path, method).security).toBeUndefined();
    expect(operation(path, method).responses?.["401"]).toBeDefined();
  });

  it("reports drift as a 200 rather than inventing a failure status", () => {
    const responses = operation("/api/db/doctor", "get").responses ?? {};
    expect(JSON.stringify(responses["200"])).toContain("DoctorReport");
    for (const code of ["400", "409", "422", "423"]) {
      expect(responses[code]).toBeUndefined();
    }
  });

  it("counts every projection table the rebuild writes, so a summary can report them", () => {
    const properties = Object.keys(componentSchemas?.["RebuildResult"]?.properties ?? {});
    expect(properties).toEqual(["path", ...PROJECTION_COUNT_FIELDS, "durationMs", "skipped"]);
  });

  it("classifies drift by the server's own closed kind vocabulary", () => {
    expect(componentSchemas?.["ProjectionDrift"]?.properties?.["kind"]?.enum).toEqual([
      ...DRIFT_KINDS,
    ]);
  });

  /** Nullable, not optional — the response-side convention this contract uses. */
  it("always carries the drift path key, null when the drift concerns no one file", () => {
    const drift = componentSchemas?.["ProjectionDrift"];
    expect(drift?.required).toEqual(["kind", "path", "detail"]);
  });

  it("neither route claims to warn, because neither writes a workspace file", () => {
    for (const component of ["RebuildResult", "DoctorReport"]) {
      expect(componentSchemas?.[component]?.properties?.["warnings"]).toBeUndefined();
    }
  });
});

describe("multipart, attachments and the stream", () => {
  it("offers both a JSON and a multipart body on turn-append", () => {
    const content = operation("/api/threads/{id}/turns", "post").requestBody?.content ?? {};
    expect(Object.keys(content)).toEqual(["application/json", "multipart/form-data"]);
  });

  /**
   * CONTRACT-009. Before it, *Ask*-with-attachments had no wire path at all:
   * `POST /api/threads` was JSON-only and Capture was the sole attachment
   * ingest. The key order matters as much as the presence — it is what
   * `openapi.json`'s byte stability and the generated client's argument order
   * both rest on.
   */
  it("offers both a JSON and a multipart body on thread creation, in the same order", () => {
    const content = operation("/api/threads", "post").requestBody?.content ?? {};
    expect(Object.keys(content)).toEqual(["application/json", "multipart/form-data"]);
  });

  it("declares capture as multipart only", () => {
    const content = operation("/api/capture", "post").requestBody?.content ?? {};
    expect(Object.keys(content)).toEqual(["multipart/form-data"]);
  });

  it("types the attached files as an array of binaries", () => {
    const schemas = document.components?.schemas ?? {};
    for (const name of [
      "MultipartAppendTurnRequest",
      "MultipartCreateThreadRequest",
      "CaptureRequest",
    ]) {
      const files = (schemas[name] as { properties?: Record<string, unknown> } | undefined)
        ?.properties?.["files"];
      expect(files).toMatchObject({ type: "array", items: { type: "string", format: "binary" } });
    }
  });

  /**
   * CONTRACT-009. `413` is declared on exactly the routes that accept bytes —
   * from both sides, so a later route that takes files without declaring it, and
   * a `413` bolted onto a route that cannot return one, both fail here.
   */
  it("declares 413 on exactly the routes that accept file uploads", () => {
    const accepting: string[] = [];
    const declaring: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op) continue;
        const signature = endpointSignature(method, path);
        if (Object.keys(op.requestBody?.content ?? {}).includes("multipart/form-data")) {
          accepting.push(signature);
        }
        if (op.responses?.["413"]) declaring.push(signature);
      }
    }
    expect(accepting.sort()).toEqual([
      "POST /api/capture",
      "POST /api/threads",
      "POST /api/threads/{id}/turns",
    ]);
    expect(declaring.sort()).toEqual(accepting.sort());
  });

  /**
   * Open Conflict 4's adjudication: the over-cap body reuses `bad_request`
   * rather than an eighth member of a union eight schemas and the CLI's error
   * renderer narrow on. The status carries the distinction.
   */
  it("gives 413 the bad_request body, leaving the error union closed", () => {
    for (const [path, method] of [
      ["/api/capture", "post"],
      ["/api/threads", "post"],
      ["/api/threads/{id}/turns", "post"],
    ] as const) {
      expect(JSON.stringify(operation(path, method).responses?.["413"])).toContain(
        "ValidationError",
      );
    }
    // The union is untouched: `413` reuses the `bad_request` variant rather
    // than adding an eighth member every narrowing site would have to learn.
    expect(componentSchemas?.["ValidationError"]?.properties?.["code"]?.enum).toEqual([
      "bad_request",
    ]);
    expect([...ERROR_CODES]).toEqual([
      "bad_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "locked",
      "internal_error",
    ]);
    expect(Object.keys(componentSchemas ?? {})).not.toContain("PayloadTooLargeError");
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

/**
 * CONTRACT-004. OpenAPI reads an omitted `requestBody.required` as `false`, and
 * `openapi-typescript` faithfully emits `requestBody?:` for it — so a mandatory
 * body that never says it is mandatory compiles away to nothing and 400s at
 * runtime. The rule pinned here is derived from the schemas, not from a
 * hand-maintained list:
 *
 *   a body is `required: false` **iff** every field in its schema is optional
 *   (a bare invocation is then a designed, documented call); a body with at
 *   least one required field is `required: true`.
 *
 * A body offering several media types is mandatory when *any* representation
 * demands a field: the caller still has to send one of the forms. The rule holds
 * across the whole surface with no exemptions — `RULE_EXEMPTIONS` is kept, and
 * asserted empty, so the next one to be proposed has to be written down here.
 */
describe("request bodies declare whether they are mandatory", () => {
  /**
   * Bodies whose declared `required` contradicts the rule, each with the reason
   * it has to. Keeping them here rather than in a route comment means an
   * exemption that stops being necessary shows up as a failing test.
   */
  const RULE_EXEMPTIONS: Readonly<Record<string, string>> = {};

  interface RequestBodyFacts {
    readonly signature: string;
    /** `undefined` means the operation is leaning on OpenAPI's implicit default. */
    readonly declared: boolean | undefined;
    /** True when every field of every representation of this body is optional. */
    readonly whollyOptional: boolean;
    readonly description: string | undefined;
    readonly mediaTypes: readonly string[];
    readonly branching: readonly string[];
  }

  /**
   * Whether a bare `{}` would satisfy the schema — the operative question behind
   * "wholly optional", and the one formulation that survives a branching body.
   * An object demands nothing when its `required` list is empty; a union is
   * satisfied by `{}` when *any* branch is; an `allOf` when *every* branch is.
   */
  function satisfiedByEmptyBody(
    node: SchemaNode | undefined,
    derefd: ReadonlySet<string>,
  ): boolean {
    if (!node) return true;

    if (node.$ref !== undefined) {
      const name = node.$ref.split("/").pop() ?? "";
      // Guards against a component that refers back to itself.
      if (derefd.has(name)) return true;
      return satisfiedByEmptyBody(componentSchemas?.[name], new Set([...derefd, name]));
    }

    const branches = node.anyOf ?? node.oneOf;
    if (branches) return branches.some((branch) => satisfiedByEmptyBody(branch, derefd));

    return (
      (node.required ?? []).length === 0 &&
      (node.allOf ?? []).every((branch) => satisfiedByEmptyBody(branch, derefd))
    );
  }

  /** Where a body branches, so reaching for `anyOf`/`oneOf` stays a deliberate act. */
  function branchingSchemas(node: SchemaNode | undefined, derefd: ReadonlySet<string>): string[] {
    if (!node) return [];

    if (node.$ref !== undefined) {
      const name = node.$ref.split("/").pop() ?? "";
      if (derefd.has(name)) return [];
      return branchingSchemas(componentSchemas?.[name], new Set([...derefd, name]));
    }

    const here = [...(node.anyOf ? ["anyOf"] : []), ...(node.oneOf ? ["oneOf"] : [])];
    return [...here, ...(node.allOf ?? []).flatMap((branch) => branchingSchemas(branch, derefd))];
  }

  function requestBodies(): RequestBodyFacts[] {
    const found: RequestBodyFacts[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const body = (item as Record<string, Operation> | undefined)?.[method]?.requestBody;
        if (!body) continue;

        const media = Object.entries(body.content ?? {}).map(
          ([mediaType, entry]) => [mediaType, (entry as { schema?: SchemaNode }).schema] as const,
        );
        found.push({
          signature: endpointSignature(method, path),
          declared: body.required,
          whollyOptional: media.every(([, schema]) => satisfiedByEmptyBody(schema, new Set())),
          description: body.description,
          mediaTypes: media.map(([mediaType]) => mediaType),
          branching: media.flatMap(([, schema]) => branchingSchemas(schema, new Set())),
        });
      }
    }
    return found.sort((a, b) => a.signature.localeCompare(b.signature));
  }

  const bodies = requestBodies();

  it("finds every request body in the surface", () => {
    // Pinned so a new body cannot slip in unexamined; the rule below is what
    // then classifies each one.
    expect(bodies).toHaveLength(14);
  });

  it("declares `required` explicitly on every one of them", () => {
    const implicit = bodies.filter((body) => body.declared === undefined);
    expect(implicit.map((body) => body.signature)).toEqual([]);
  });

  it("declares `required` exactly as the schemas dictate", () => {
    const violations = bodies
      .filter((body) => body.declared !== !body.whollyOptional)
      .filter((body) => !(body.signature in RULE_EXEMPTIONS));
    expect(
      violations.map((body) => `${body.signature}: declared ${String(body.declared)}`),
    ).toEqual([]);
  });

  it("earns no exemption from the rule at all", () => {
    // The one exemption this list ever held — the dual-media turn append, which
    // `@hono/zod-openapi@1.5.1` cannot validate when `required` is truthy — was
    // closed by `routes/turn-append.ts`: the document declares `required: true`
    // and the mounting helper dispatches on `content-type` itself. The list
    // stays, asserted empty, so the next exemption has to be argued for here
    // rather than added quietly.
    const unearned = bodies.filter(
      (body) => body.signature in RULE_EXEMPTIONS && body.declared === !body.whollyOptional,
    );
    expect(unearned.map((body) => body.signature)).toEqual([]);
    expect(Object.keys(RULE_EXEMPTIONS)).toEqual([]);
  });

  /**
   * A branching body makes "every field is optional" branch-relative, which is
   * why `satisfiedByEmptyBody` asks the question the rule actually needs rather
   * than counting required fields. The list is pinned anyway: branching is the
   * shape that makes a request-level XOR expressible (CONTRACT-008's
   * `POST /api/check`), and nothing should reach for it without saying so here.
   */
  it("names every branching request body, so a new one is a deliberate choice", () => {
    const branching = bodies.filter((body) => body.branching.length > 0);
    expect(branching.map((body) => `${body.signature}: ${body.branching.join(",")}`)).toEqual([
      "POST /api/check: anyOf",
    ]);
  });

  it("partitions the surface into the mandatory and the omittable sets", () => {
    const partition = Object.fromEntries(bodies.map((body) => [body.signature, body.declared]));
    expect(partition).toEqual({
      "POST /api/capture": true,
      "POST /api/check": true,
      "POST /api/docs": true,
      "POST /api/docs/{id}/move": true,
      "POST /api/jobs/{id}/log": true,
      "POST /api/threads": true,
      "POST /api/locks/{docId}": false,
      "POST /api/queue/halt": false,
      "POST /api/queue/{id}/fail": false,
      "POST /api/skills/{name}/rollback": false,
      "POST /api/threads/{id}/seen": false,
      "POST /api/threads/{id}/turns": true,
      "POST /api/threads/{id}/turns/{ts}/form": true,
      "PUT /api/docs/{id}": false,
    });
  });

  it("treats a multipart body as a body", () => {
    const multipart = bodies.filter((body) => body.mediaTypes.includes("multipart/form-data"));
    expect(multipart.map((body) => body.signature)).toEqual([
      "POST /api/capture",
      "POST /api/threads",
      "POST /api/threads/{id}/turns",
    ]);
    expect(multipart.every((body) => body.declared !== undefined)).toBe(true);
  });

  it("tells the caller, on every genuinely bare-callable body, that omitting it is a real call", () => {
    const bare = bodies.filter((body) => body.declared === false && body.whollyOptional);
    const undocumented = bare.filter(
      (body) => !/omit the body entirely/i.test(body.description ?? ""),
    );
    expect(undocumented.map((body) => body.signature)).toEqual([]);
  });

  it("says what a bare re-halt does to a recorded reason", () => {
    // The halt sentinel is rewritten wholesale, so a bare re-halt does not
    // merely leave a previously recorded reason alone — it clears it.
    expect(operation("/api/queue/halt", "post").description).toContain("replace, add, or clear");
  });
});

/**
 * CONTRACT-017: strict bodies, tolerant reads. Every request body — JSON and
 * multipart alike — rejects unknown top-level keys with a `400` naming the key,
 * so a typoed key (`anchor` for `selector`, the eval that filed the issue) can
 * never validate as a silently different mutation. The policy and its
 * boundaries — open *values* like `extra` stay open, queries and headers stay
 * tolerant — are stated in `./schemas/index.ts`.
 */
describe("request bodies are strict (CONTRACT-017)", () => {
  function deref(node: SchemaNode | undefined): SchemaNode | undefined {
    if (node?.$ref === undefined) return node;
    return componentSchemas?.[node.$ref.split("/").pop() ?? ""];
  }

  it("declares additionalProperties: false on every request body in the document", () => {
    const seen: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        if (!item || !(method in (item as object))) continue;
        const content = operation(path, method).requestBody?.content ?? {};
        for (const [mediaType, mediaObject] of Object.entries(content)) {
          const where = `${method.toUpperCase()} ${path} (${mediaType})`;
          seen.push(where);
          const schema = deref((mediaObject as { schema?: SchemaNode }).schema);
          // A branching body (the /api/check XOR) is strict when every branch is.
          const branches = schema?.anyOf ?? schema?.oneOf ?? [schema];
          for (const branch of branches) {
            expect(deref(branch)?.additionalProperties, where).toBe(false);
          }
        }
      }
    }
    // The sweep must not pass by matching nothing: the surface carries at least
    // the fifteen bodies it had when the rule landed.
    expect(seen.length).toBeGreaterThanOrEqual(15);
  });
});
