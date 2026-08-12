import { describe, expect, it } from "vitest";
import { ACTOR_HEADER, ACTORS, DEFAULT_ACTOR } from "./actor.js";
import { BEARER_SECURITY_SCHEME, buildOpenApiDocument, CONTRACT_VERSION } from "./openapi.js";
import { BULK_ACTION_NAMES } from "./schemas/bulk.js";
import { CHECK_CODES, CHECK_WARNING_CODES } from "./schemas/check.js";
import {
  CONTEXT_MAX_EXCERPT_CHARS,
  CONTEXT_MAX_EXCERPTS,
  CONTEXT_MAX_QUOTE_CHARS,
  CONTEXT_MAX_SECTION_CHARS,
  CONTEXT_PACK_SHAPES,
} from "./schemas/context.js";
import { DRIFT_KINDS, PROJECTION_COUNT_FIELDS } from "./schemas/db.js";
import { DOC_DIFF_MAX_CHARS, DOC_EDITED_EVENT_TYPE } from "./schemas/edit.js";
import { ERROR_CODES } from "./schemas/error.js";
import {
  CORE_QUEUE_EVENT_TYPES,
  MAX_IN_PROGRESS_REPORTED,
  QUEUE_EVENT_STATUSES,
} from "./schemas/queue.js";
import { docFilterShape } from "./schemas/query.js";
import {
  HEADING_PATH_SEPARATOR,
  RELATIONS,
  RETRIEVAL_DEFAULT_LIMIT,
  RETRIEVAL_MAX_LIMIT,
  SEMANTIC_INDEX_STATES,
} from "./schemas/retrieval.js";
import { SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./schemas/skill.js";
import { EXTRA_MAX_BYTES, EXTRA_MAX_DEPTH, RESERVED_FRONTMATTER_KEYS } from "./schemas/extra.js";
import { WARNING_CODES } from "./schemas/warning.js";
import { REQUESTED_WEIGHT_MAX_LENGTH } from "./schemas/weight.js";
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
  readonly pattern?: string;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly required?: string[];
  /** OpenAPI 3.1 is JSON Schema 2020-12, so a conditional requirement is publishable. */
  readonly dependentRequired?: Record<string, string[]>;
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly discriminator?: { propertyName: string; mapping?: Record<string, string> };
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
    // CONTRACT-042's rider, beside `pinned` because both are docs-only: §9.2's
    // signed `/api/search` parameter string carries neither.
    "isParent",
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

  /**
   * CONTRACT-042. The name reads as "has children" and means the opposite, so
   * the published description is the only thing standing between the next
   * reader and a well-intentioned inversion of the filter. Each clause the
   * issue required is pinned individually: what it selects, the rejected
   * reading, that it is not thread-only, and what happens beside `parent`.
   */
  describe("the isParent filter", () => {
    const description = (): string => parameter("/api/docs", "get", "isParent")?.description ?? "";

    it("types it as a boolean, like every other flag on this endpoint", () => {
      const param = parameter("/api/docs", "get", "isParent");
      expect(param?.schema?.type).toBe("boolean");
      expect(param?.required).toBe(false);
    });

    it("says plainly that it selects roots, not documents that have children", () => {
      expect(description()).toContain("**roots**");
      expect(description()).toContain("no parent");
      expect(description()).toContain('does not mean "has children."');
    });

    it("names the rejected reading, so nobody re-derives it as a bug", () => {
      expect(description()).toContain('"has at least one child"');
      expect(description()).toContain("rejected");
      expect(description()).toContain("under");
    });

    it("states that absent filters nothing rather than defaulting to true", () => {
      expect(description()).toContain("Absent filters nothing");
      expect(description()).toContain("no default of `true`");
    });

    it("states that it is not thread-only, unlike `parent`", () => {
      expect(description()).toContain("**Not thread-only**");
      expect(description()).toContain("an answer, not a");
    });

    it("states the decided outcome of combining it with `parent`", () => {
      expect(description()).toContain("`400`");
      expect(description()).toContain("rather than answered with an empty set");
      expect(description()).toContain("`parent=<id>&isParent=false` is merely redundant");
    });

    it("is declared on the collection query and deliberately not on search", () => {
      expect(parameter("/api/docs", "get", "isParent")).toBeDefined();
      expect(parameter("/api/search", "get", "isParent")).toBeUndefined();
    });
  });

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
 * CONTRACT-022: SPEC.md §7's two retrieval verbs, as SHARED-006 Edits 7 and 8
 * spell them. Two things are being pinned here beyond the shapes: that the
 * filter grammar has **one** definition site (so `/api/search` cannot drift from
 * `/api/docs`), and that the frozen seams Retrieval Phase B needs — the
 * semantic-state field and the full relation vocabulary — are published now and
 * carry nothing behind them.
 */
describe("the retrieval surface (CONTRACT-022)", () => {
  const SEARCH_PATH = "/api/search";
  const RELATED_PATH = "/api/docs/{id}/related";

  it("adds exactly two endpoints to the inventory", () => {
    expect(ENDPOINT_INVENTORY).toContain("GET /api/search");
    expect(ENDPOINT_INVENTORY).toContain("GET /api/docs/{id}/related");
  });

  it.each([SEARCH_PATH, RELATED_PATH])("requires the workspace bearer token on %s", (path) => {
    expect(operation(path, "get").security).toBeUndefined();
    expect(operation(path, "get").responses?.["401"]).toBeDefined();
  });

  it("declares only the codes a search can produce", () => {
    expect(Object.keys(operation(SEARCH_PATH, "get").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
    ]);
  });

  it("declares only the codes a related read can produce, 404 among them", () => {
    expect(Object.keys(operation(RELATED_PATH, "get").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "404",
    ]);
  });

  it("reuses the shipped not-found envelope rather than inventing one for a read", () => {
    const content = operation(RELATED_PATH, "get").responses?.["404"]?.content ?? {};
    const schema = (content["application/json"] as { schema?: SchemaNode } | undefined)?.schema;
    expect(schema?.$ref).toBe("#/components/schemas/NotFoundError");
  });

  /** Read-only, so neither declares the acting party nor takes a body (SPEC.md §9.2). */
  it.each([SEARCH_PATH, RELATED_PATH])("names no acting party on %s", (path) => {
    const op = operation(path, "get");
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters?.some((entry) => entry.in === "header")).toBe(false);
    expect(op.description).toContain("Read-only; no acting party.");
  });

  describe("the search parameter grammar", () => {
    /** Edit 7's signed parameter string, in its signed order. */
    const SIGNED_PARAMS = [
      "q",
      "type",
      "status",
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
      "needs",
      "limit",
    ];

    it("declares exactly the signed parameter list, in order", () => {
      const params = operation(SEARCH_PATH, "get").parameters ?? [];
      expect(params.map((entry) => entry.name)).toEqual(SIGNED_PARAMS);
      for (const entry of params) expect(entry.in).toBe("query");
    });

    it("makes the query required and everything else optional", () => {
      expect(parameter(SEARCH_PATH, "get", "q")?.required).toBe(true);
      for (const entry of operation(SEARCH_PATH, "get").parameters ?? []) {
        if (entry.name !== "q") expect(entry.required).toBe(false);
      }
    });

    it.each(["pinned", "sort", "offset", "isParent"])("declares no %s", (name) => {
      expect(parameter(SEARCH_PATH, "get", name)).toBeUndefined();
    });

    it("says what happens to an undeclared parameter, since silence is the alternative", () => {
      expect(operation(SEARCH_PATH, "get").description).toContain(
        "`pinned`, `sort` and `offset` are not among them and are ignored if sent",
      );
    });

    /**
     * CONTRACT-042. `isParent` is a structural filter and would belong in the
     * shared shape on the merits; it is held back only because §9.2's signed
     * search parameter string does not carry it. Saying so in the published
     * description keeps the omission a recorded decision rather than a
     * suspected oversight.
     */
    it("records why isParent is the one structural filter it does not share", () => {
      expect(operation(SEARCH_PATH, "get").description).toContain(
        "neither is `isParent`, which §9.2's signed parameter string declares on the collection " +
          "query alone",
      );
    });

    /**
     * The one-definition-site proof. Both parameter sets are compared **through
     * the shared shape**, so adding a filter to `docFilterShape` extends this
     * assertion to both endpoints without an edit — and a filter added to only
     * one of them fails here rather than at some consumer months later.
     */
    it.each(Object.keys(docFilterShape))(
      "publishes %s identically on the collection query and on search",
      (name) => {
        const onDocs = parameter("/api/docs", "get", name);
        const onSearch = parameter(SEARCH_PATH, "get", name);
        expect(onDocs).toBeDefined();
        expect(onSearch).toEqual(onDocs);
      },
    );

    it("shares every filter and nothing but the filters", () => {
      const searchNames = (operation(SEARCH_PATH, "get").parameters ?? []).map(
        (entry) => entry.name,
      );
      expect(searchNames).toEqual(["q", ...Object.keys(docFilterShape), "limit"]);
    });

    it("caps results below the list convention, and says why there is no paging", () => {
      const limit = parameter(SEARCH_PATH, "get", "limit");
      expect(limit?.schema?.default).toBe(RETRIEVAL_DEFAULT_LIMIT);
      expect(limit?.schema).toMatchObject({
        type: "integer",
        minimum: 1,
        maximum: RETRIEVAL_MAX_LIMIT,
      });
      expect(limit?.description).toContain("There is no `offset`");
    });
  });

  describe("the hit shape", () => {
    it("is an address and a line of context — and the absences are the contract", () => {
      const hit = componentSchemas?.["SearchHit"];
      expect(Object.keys(hit?.properties ?? {})).toEqual(["id", "title", "headingPath", "snippet"]);
      expect(hit?.required).toEqual(["id", "title", "headingPath", "snippet"]);
    });

    it("says `never a body` where a client author reads it", () => {
      expect(operation(SEARCH_PATH, "get").description).toContain("never a body");
      expect(componentSchemas?.["SearchHit"]?.properties?.["snippet"]?.description).toContain(
        "never the passage",
      );
    });

    it("publishes the heading path's separator and its display-join rule", () => {
      const description = componentSchemas?.["SearchHit"]?.properties?.["headingPath"]?.description;
      expect(description).toContain(HEADING_PATH_SEPARATOR);
      expect(description).toContain("print it, never split it");
      expect(description).toContain("turn's heading");
    });
  });

  describe("Phase B's two frozen seams", () => {
    it.each(["SearchResults", "RelatedDocs"])(
      "carries the optional semantic state on %s",
      (name) => {
        const envelope = componentSchemas?.[name];
        expect(Object.keys(envelope?.properties ?? {})).toContain("semanticIndex");
        expect(envelope?.required).not.toContain("semanticIndex");
        expect(envelope?.properties?.["semanticIndex"]?.enum).toEqual([...SEMANTIC_INDEX_STATES]);
      },
    );

    it("documents the field as Phase B's seam and tells consumers not to switch on it", () => {
      const description =
        componentSchemas?.["SearchResults"]?.properties?.["semanticIndex"]?.description;
      expect(description).toContain("Retrieval Phase B's seam, inert in Phase A");
      expect(description).toContain("Treat **any** value other than `current` as degraded");
    });

    it("publishes the whole relation vocabulary though Phase A emits one of it", () => {
      const relation = componentSchemas?.["RelatedDoc"]?.properties?.["relation"];
      expect(relation?.enum).toEqual([...RELATIONS]);
      expect(relation?.description).toContain("Retrieval Phase A emits only `linked`");
    });

    it("pages neither envelope, so no `page` meta describes a ranking", () => {
      expect(Object.keys(componentSchemas?.["SearchResults"]?.properties ?? {})).toEqual([
        "hits",
        "semanticIndex",
      ]);
      expect(Object.keys(componentSchemas?.["RelatedDocs"]?.properties ?? {})).toEqual([
        "related",
        "semanticIndex",
      ]);
    });
  });

  describe("the related read", () => {
    it("takes the document id in the path and two query parameters", () => {
      const params = operation(RELATED_PATH, "get").parameters ?? [];
      expect(params.map((entry) => entry.name)).toEqual(["id", "limit", "includeArchived"]);
      expect(params[0]?.in).toBe("path");
      expect(params[0]?.required).toBe(true);
      expect(params[0]?.schema?.type).toBe("string");
      for (const entry of params.slice(1)) {
        expect(entry.in).toBe("query");
        expect(entry.required).toBe(false);
      }
    });

    it("shares ranked search's cap", () => {
      expect(parameter(RELATED_PATH, "get", "limit")?.schema?.default).toBe(
        RETRIEVAL_DEFAULT_LIMIT,
      );
      expect(parameter(RELATED_PATH, "get", "limit")?.schema).toMatchObject({
        maximum: RETRIEVAL_MAX_LIMIT,
      });
    });

    it("applies the archived default every list applies", () => {
      const param = parameter(RELATED_PATH, "get", "includeArchived");
      expect(param?.schema?.type).toBe("boolean");
      expect(param?.schema?.default).toBeUndefined();
      expect(param?.description).toContain("union");
      expect(operation(RELATED_PATH, "get").description).toContain(
        "Archived documents are excluded unless `includeArchived` lifts the default",
      );
    });

    it("is a row of id, title, one line and why", () => {
      const row = componentSchemas?.["RelatedDoc"];
      expect(Object.keys(row?.properties ?? {})).toEqual(["id", "title", "excerpt", "relation"]);
      expect(row?.required).toEqual(["id", "title", "excerpt", "relation"]);
      expect(row?.properties?.["excerpt"]?.description).toContain("never enough to read it");
    });

    it("says a dangling reference is not a row, since `links` stores them on purpose", () => {
      expect(operation(RELATED_PATH, "get").description).toContain("stores dangling references");
    });
  });
});

/**
 * CONTRACT-023: the semantic index's maintenance pair. Everything here is
 * additive against the frozen retrieval shapes above — the enum does not widen,
 * the envelopes do not move, and the two new operations reuse one component.
 */
describe("the semantic-index surface (CONTRACT-023)", () => {
  const STATUS_PATH = "/api/index/status";
  const REBUILD_PATH = "/api/index/rebuild";

  it("adds exactly two endpoints to the inventory, spelled as §9.2 spells them", () => {
    expect(ENDPOINT_INVENTORY).toContain("GET /api/index/status");
    expect(ENDPOINT_INVENTORY).toContain("POST /api/index/rebuild");
  });

  it.each([
    [STATUS_PATH, "get"],
    [REBUILD_PATH, "post"],
  ])("requires the workspace bearer token on %s %s", (path, method) => {
    expect(operation(path, method).security).toBeUndefined();
    expect(operation(path, method).responses?.["401"]).toBeDefined();
  });

  /**
   * SPEC.md §9.2's index bullet: "Both touch only derived runtime state — no
   * workspace file changes, no git commit, **no acting party**." A route names
   * the acting party with a header parameter, so its absence is the assertion —
   * and the deliberate divergence from `POST /api/db/rebuild`, which declares
   * one, is asserted from the other side in the same breath.
   */
  it.each([
    [STATUS_PATH, "get"],
    [REBUILD_PATH, "post"],
  ])("names no acting party and takes no body on %s %s", (path, method) => {
    const op = operation(path, method);
    expect(op.parameters ?? []).toEqual([]);
    expect(op.requestBody).toBeUndefined();
  });

  it("keeps the projection rebuild's acting party, so the divergence is visible", () => {
    const header = operation("/api/db/rebuild", "post").parameters?.find(
      (entry) => entry.in === "header",
    );
    expect(header?.name).toBe(ACTOR_HEADER);
  });

  it("declares only the codes each can produce, and no 400 with nothing to validate", () => {
    expect(Object.keys(operation(STATUS_PATH, "get").responses ?? {})).toEqual(["200", "401"]);
    expect(Object.keys(operation(REBUILD_PATH, "post").responses ?? {})).toEqual(["202", "401"]);
  });

  /**
   * Open Conflict 8, ruled: the rebuild returns before the work is done, so the
   * only honest response is what is already true. It answers with the same
   * `IndexStatus` component `status` returns — a snapshot taken after queueing,
   * not an outcome — under `202`, which is the status code for exactly that.
   */
  it("answers both operations with the one status component", () => {
    for (const [path, method, code] of [
      [STATUS_PATH, "get", "200"],
      [REBUILD_PATH, "post", "202"],
    ] as const) {
      const content = operation(path, method).responses?.[code]?.content ?? {};
      const schema = (content["application/json"] as { schema?: SchemaNode } | undefined)?.schema;
      expect(schema?.$ref).toBe("#/components/schemas/IndexStatus");
    }
  });

  it("says in the rebuild's own description that it returned before finishing", () => {
    const description = operation(REBUILD_PATH, "post").description ?? "";
    expect(description).toContain("**Returns immediately, before the work is done**");
    expect(description).toContain("never a claim of completion");
    expect(description).toContain("carries no acting party");
  });

  /**
   * The 2026-08-01 rider added a seventh property and made none of it required:
   * `detail` is a sentence for a person, absent whenever there is nothing to
   * say. The `required` list below is the assertion that matters — a generated
   * client compiles against it, and a field arriving required would be a build
   * break rather than a runtime surprise.
   */
  it("is counts, identity, a flag and the state word — all required — plus an optional sentence", () => {
    const status = componentSchemas?.["IndexStatus"];
    expect(Object.keys(status?.properties ?? {})).toEqual([
      "indexed",
      "pending",
      "failed",
      "identity",
      "rebuilding",
      "state",
      "detail",
    ]);
    expect(status?.required).toEqual([
      "indexed",
      "pending",
      "failed",
      "identity",
      "rebuilding",
      "state",
    ]);
  });

  /**
   * The one-vocabulary invariant, at the document level: the status endpoint's
   * `state` publishes the identical enum the two retrieval envelopes publish as
   * `semanticIndex`, so no client can be handed two different descriptions of
   * one workspace. A fifth value invented for this endpoint fails here.
   */
  it("reuses the frozen retrieval enum rather than declaring a second one", () => {
    expect(componentSchemas?.["IndexStatus"]?.properties?.["state"]?.enum).toEqual([
      ...SEMANTIC_INDEX_STATES,
    ]);
    for (const envelope of ["SearchResults", "RelatedDocs"]) {
      expect(componentSchemas?.[envelope]?.properties?.["semanticIndex"]?.enum).toEqual(
        componentSchemas?.["IndexStatus"]?.properties?.["state"]?.enum,
      );
    }
  });

  it("publishes the fact-to-word mapping where an implementer and a client both read it", () => {
    const description = componentSchemas?.["IndexStatus"]?.properties?.["state"]?.description ?? "";
    expect(description).toContain("Derived from the fields above rather than stored");
    expect(description).toContain("`indexing` — `rebuilding` is true, which outranks `stale`");
    expect(description).toContain("`disabled` — no provider resolved");
  });

  it("keeps the recorded identity nullable, since a fresh workspace has none", () => {
    const identity = componentSchemas?.["IndexStatus"]?.properties?.["identity"];
    expect(identity?.type).toEqual(["string", "null"]);
    expect(identity?.description).toContain("never parsed");
  });

  it("points the retrieval envelopes' one-word field at this endpoint for the detail", () => {
    const description =
      componentSchemas?.["SearchResults"]?.properties?.["semanticIndex"]?.description ?? "";
    expect(description).toContain("`GET /api/index/status` is the detailed surface");
  });

  it("adds no drift kind and no doctor warning kind, since neither is index business", () => {
    expect(componentSchemas?.["ProjectionDrift"]?.properties?.["kind"]?.enum).toEqual([
      ...DRIFT_KINDS,
    ]);
    // A stuck index's doctor warning (Open Conflict 9) rides the **open** kind
    // space `DoctorWarningKind` already publishes, so it costs no contract
    // change and no literal is added here. See `routes/index-maintenance.test.ts`.
    expect(componentSchemas?.["DoctorWarning"]?.properties?.["kind"]?.type).toBe("string");
  });
});

/**
 * CONTRACT-024: the context pack. Retrieval Phase C's one endpoint, and the
 * contract's **first response-side bound** — so the assertions here are mostly
 * about what reaches the published document, since that is the only place the
 * caps exist for a client author (`z.infer` erases `.max()`, and nothing in the
 * shipped stack validates a response — sprint-022 C5).
 */
describe("the context pack (CONTRACT-024)", () => {
  const CONTEXT_PATH = "/api/threads/{id}/context";

  const VARIANTS = [
    "AnchoredContextPack",
    "WholeDocumentContextPack",
    "OrphanedAnchorContextPack",
    "StandaloneContextPack",
    "DeletedParentContextPack",
  ] as const;

  const packSchema = (): SchemaNode =>
    (
      operation(CONTEXT_PATH, "get").responses?.["200"]?.content?.["application/json"] as {
        schema: SchemaNode;
      }
    ).schema;

  const parentOf = (variant: string): SchemaNode | undefined =>
    componentSchemas?.[variant]?.properties?.["parent"];

  it("adds exactly one endpoint to the inventory, spelled as §9.2 spells it", () => {
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("/context"))).toEqual([
      "GET /api/threads/{id}/context",
    ]);
  });

  it("requires the workspace bearer token and declares the read's codes", () => {
    const op = operation(CONTEXT_PATH, "get");
    expect(op.security).toBeUndefined();
    expect(Object.keys(op.responses ?? {})).toEqual(["200", "400", "401", "404"]);
  });

  /**
   * SPEC.md:344: "Read-only; no acting party." A route names one with a header
   * parameter, so the assertion is that the only parameter is the path id — and
   * that there is no request body to carry an instruction either.
   */
  it("names no acting party, takes no body, and declares no query parameter", () => {
    const op = operation(CONTEXT_PATH, "get");
    expect(op.parameters?.map((entry) => `${entry.in}:${entry.name}`)).toEqual(["path:id"]);
    expect(op.requestBody).toBeUndefined();
    expect(op.description).toContain("Read-only; no acting party");
  });

  /**
   * The five shapes, discriminated on one field. The `oneOf` is **inlined** into
   * the response rather than registered under a name: a registered union has no
   * `type: "object"`, and the "every named component is a plain, non-nullable,
   * undefaulted object" invariant above is the guard that catches
   * `Named.nullable()` corrupting a shared component. Inlining keeps that
   * invariant strict while still publishing every branch as a referenced
   * component, which is what a client generator consumes.
   */
  it("answers with a five-way discriminated union, keyed on `shape`", () => {
    const schema = packSchema();
    expect(schema.oneOf?.map((branch) => branch.$ref?.split("/").pop())).toEqual([...VARIANTS]);
    expect(schema.discriminator?.propertyName).toBe("shape");
    expect(Object.keys(schema.discriminator?.mapping ?? {})).toEqual([...CONTEXT_PACK_SHAPES]);
  });

  it("registers each branch as a plain object component rather than naming the union", () => {
    expect(Object.keys(componentSchemas ?? {})).not.toContain("ContextPack");
    for (const variant of VARIANTS) {
      expect(componentSchemas?.[variant]?.type, variant).toBe("object");
    }
  });

  /**
   * TEST-943's published half: the shape is readable from one field, and the
   * cases that carry no parent content carry no `parent` property at all — an
   * absence a generated type reproduces, so a client cannot probe for a block
   * that was never declared.
   */
  it.each([
    [
      "AnchoredContextPack",
      "anchored",
      ["id", "title", "headingPath", "quote", "section", "truncated"],
    ],
    ["WholeDocumentContextPack", "whole-document", ["id", "title", "opening", "truncated"]],
    ["OrphanedAnchorContextPack", "orphaned-anchor", ["id", "title", "quote", "truncated"]],
  ])("gives %s the `%s` literal and exactly its own parent fields", (variant, shape, fields) => {
    expect(componentSchemas?.[variant]?.properties?.["shape"]?.enum).toEqual([shape]);
    expect(Object.keys(parentOf(variant)?.properties ?? {})).toEqual(fields);
    expect(componentSchemas?.[variant]?.required).toContain("parent");
  });

  it("declares no parent block on the two parentless shapes", () => {
    for (const variant of ["StandaloneContextPack", "DeletedParentContextPack"]) {
      expect(Object.keys(componentSchemas?.[variant]?.properties ?? {}), variant).not.toContain(
        "parent",
      );
    }
  });

  /** Open Conflict 9: the deleted parent is named, and naming it is mandatory. */
  it("makes the deleted parent's id a required statement rather than an optional hint", () => {
    expect(componentSchemas?.["DeletedParentContextPack"]?.required).toContain("deletedParent");
    expect(operation(CONTEXT_PATH, "get").description).toContain("still a `200`");
  });

  /**
   * TEST-945/TEST-946's published half. The `.max()` calls exist to put
   * `maxItems` and `maxLength` into this document — that, plus a `safeParse`
   * that rejects overflow, is the whole of what a response-side bound can be
   * (Open Conflict 4). Actual enforcement is SERVER-047's rank-then-cut.
   */
  it("publishes the excerpt count cap on every shape's excerpt array", () => {
    for (const variant of VARIANTS) {
      expect(componentSchemas?.[variant]?.properties?.["excerpts"]?.maxItems, variant).toBe(
        CONTEXT_MAX_EXCERPTS,
      );
    }
  });

  it("publishes the per-excerpt length cap on the row every shape shares", () => {
    expect(componentSchemas?.["ContextExcerpt"]?.properties?.["excerpt"]?.maxLength).toBe(
      CONTEXT_MAX_EXCERPT_CHARS,
    );
  });

  it.each([
    ["AnchoredContextPack", "section", CONTEXT_MAX_SECTION_CHARS],
    ["WholeDocumentContextPack", "opening", CONTEXT_MAX_SECTION_CHARS],
    ["AnchoredContextPack", "quote", CONTEXT_MAX_QUOTE_CHARS],
    ["OrphanedAnchorContextPack", "quote", CONTEXT_MAX_QUOTE_CHARS],
  ])("publishes %s.parent.%s's length cap", (variant, field, cap) => {
    expect(parentOf(variant)?.properties?.[field]?.maxLength).toBe(cap);
  });

  /**
   * Open Conflict 1: the bound wins, but visibly. A silently truncated section
   * is worse than no section — the agent would edit against text it believes is
   * complete — so the flag is required on every parent block that carries prose,
   * and the escalation path is named in the published description.
   */
  it("requires the truncation flag wherever parent-side prose is carried", () => {
    for (const variant of [
      "AnchoredContextPack",
      "WholeDocumentContextPack",
      "OrphanedAnchorContextPack",
    ]) {
      expect(parentOf(variant)?.required, variant).toContain("truncated");
      expect(parentOf(variant)?.properties?.["truncated"]?.description).toContain(
        "anchored on the anchor",
      );
    }
  });

  /**
   * TEST-949 / C4. SPEC.md:285 and :344 both say "each an id + heading path +
   * short excerpt"; `RelatedDoc` was considered and is one field short — it has
   * no `headingPath`, and its excerpt is the document's *opening* line rather
   * than the passage that matched.
   */
  it("is an id, a heading path, a short excerpt and a relation — and never a body", () => {
    const excerpt = componentSchemas?.["ContextExcerpt"];
    expect(Object.keys(excerpt?.properties ?? {})).toEqual([
      "id",
      "headingPath",
      "excerpt",
      "relation",
    ]);
    expect(excerpt?.required).toEqual(["id", "headingPath", "excerpt", "relation"]);
    expect(excerpt?.properties?.["relation"]?.enum).toEqual([...RELATIONS]);
    expect(excerpt?.properties?.["excerpt"]?.description).toContain("never enough to replace");
  });

  it("keeps the related row's heading path on the same display-join rule as a search hit", () => {
    const description =
      componentSchemas?.["ContextExcerpt"]?.properties?.["headingPath"]?.description;
    expect(description).toContain(HEADING_PATH_SEPARATOR);
    expect(description).toContain("print it, never split it");
  });

  /**
   * Open Conflict 3 / C6. The pack is the third ranked surface, and it must
   * report the same word the other two report for the same workspace — so it
   * reuses `semanticIndexField` rather than declaring an enum beside it. Both
   * the vocabulary *and* the published sentence are compared, because a retyped
   * description is how two surfaces start meaning different things.
   */
  it("reuses the retrieval envelopes' staleness field byte for byte", () => {
    const shared = componentSchemas?.["SearchResults"]?.properties?.["semanticIndex"];
    expect(shared?.enum).toEqual([...SEMANTIC_INDEX_STATES]);
    for (const variant of VARIANTS) {
      const field = componentSchemas?.[variant]?.properties?.["semanticIndex"];
      expect(field?.enum, variant).toEqual(shared?.enum);
      expect(field?.description, variant).toBe(shared?.description);
      expect(componentSchemas?.[variant]?.required, variant).not.toContain("semanticIndex");
    }
  });

  it("states the bound, the truncation escalation and the shared degrade word in the route's prose", () => {
    const description = operation(CONTEXT_PATH, "get").description ?? "";
    expect(description).toContain(
      "reading a pack costs roughly the same however large the corpus grows",
    );
    expect(description).toContain("truncated around the anchor");
    expect(description).toContain("**No query parameters**");
    expect(description).toContain("/api/docs/{id}/related");
  });
});

/**
 * CONTRACT-028: SPEC.md §4's edit acknowledgment, as it reaches the published
 * document — the `doc.edited` type in the core vocabulary every event-carrying
 * shape prints, and the bounded diff read behind `corpus doc diff <id>`. The
 * rider's three load-bearing clauses are each asserted against the document a
 * client author actually reads: never the diff body, one bounded read, and a
 * `404` that means only what it says.
 */
describe("the edit-acknowledgment surface (CONTRACT-028)", () => {
  const DIFF_PATH = "/api/docs/{id}/diff";

  it("adds exactly one endpoint to the inventory", () => {
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("/diff"))).toEqual([
      "GET /api/docs/{id}/diff",
    ]);
  });

  it("requires the workspace bearer token and declares only a read's codes", () => {
    const op = operation(DIFF_PATH, "get");
    expect(op.security).toBeUndefined();
    expect(Object.keys(op.responses ?? {})).toEqual(["200", "400", "401", "404"]);
  });

  it("names no acting party and takes no body — reading a diff writes nothing", () => {
    const op = operation(DIFF_PATH, "get");
    expect(op.parameters?.map((entry) => `${entry.in}:${entry.name}`)).toEqual([
      "path:id",
      "query:from",
      "query:to",
    ]);
    expect(op.requestBody).toBeUndefined();
    expect(op.description).toContain("Read-only; no acting party.");
  });

  /**
   * Both halves optional, and neither defaulted in the document: the defaults
   * are computed from the document's own history, so a published `default`
   * would both be a lie and — per `./schemas/index.ts` — promote the property
   * to required in the generated client.
   */
  it.each(["from", "to"])("publishes %s as an optional, undefaulted sha", (name) => {
    const param = parameter(DIFF_PATH, "get", name);
    expect(param?.required).toBe(false);
    expect(param?.schema?.type).toBe("string");
    expect(param?.schema?.default).toBeUndefined();
    expect(JSON.stringify(param?.schema)).toContain("^[0-9a-f]{7,64}$");
  });

  it("states the frugality bound, the truncation and the 400-not-404 rule in its prose", () => {
    const description = operation(DIFF_PATH, "get").description ?? "";
    expect(description).toContain(
      "Reading a diff costs roughly the same however large the document or the change",
    );
    expect(description).toContain("truncated, not refused");
    expect(description).toContain(String(DOC_DIFF_MAX_CHARS));
    expect(description).toContain("never a `404`");
    expect(description).toContain("Path-scoped");
  });

  it("publishes the diff body's cap, which is the whole of what a response bound can be", () => {
    expect(componentSchemas?.["DocDiff"]?.properties?.["diff"]?.maxLength).toBe(DOC_DIFF_MAX_CHARS);
  });

  it("is the resolved range, the stats, the body and how much of it was cut", () => {
    const diff = componentSchemas?.["DocDiff"];
    expect(Object.keys(diff?.properties ?? {})).toEqual([
      "id",
      "path",
      "from",
      "to",
      "stats",
      "diff",
      "truncated",
      "totalChars",
    ]);
    expect(diff?.required).toEqual([
      "id",
      "path",
      "from",
      "to",
      "stats",
      "diff",
      "truncated",
      "totalChars",
    ]);
  });

  /** The no-history answer has to be representable, or it becomes an error. */
  it.each(["from", "to"])(
    "makes the resolved %s nullable for a never-committed document",
    (key) => {
      expect(componentSchemas?.["DocDiff"]?.properties?.[key]?.type).toEqual(["string", "null"]);
    },
  );

  it("carries three counts and no file count, since a file count would be a constant", () => {
    const stats = componentSchemas?.["DocChangeStats"];
    expect(Object.keys(stats?.properties ?? {})).toEqual(["commits", "insertions", "deletions"]);
    expect(stats?.required).toEqual(["commits", "insertions", "deletions"]);
    for (const key of ["commits", "insertions", "deletions"]) {
      expect(stats?.properties?.[key]?.minimum, key).toBe(0);
    }
  });

  /**
   * The rider's "never the diff body": the event payload stays the open record
   * §7 keeps it as, and no published component describes a `doc.edited`
   * payload — the schema is a parse-side narrowing beside the feature, exactly
   * as `form.respond`'s is, so nothing invites a producer to put a diff in one.
   */
  it("publishes no doc.edited payload component, keeping the envelope open", () => {
    expect(Object.keys(componentSchemas ?? {})).not.toContain("DocEditedPayload");
    expect(componentSchemas?.["QueueEvent"]?.properties?.["payload"]?.type).toBe("object");
  });

  it.each(["QueueEvent", "Job"])("names doc.edited among %s's core types", (name) => {
    expect(componentSchemas?.[name]?.properties?.["type"]?.description).toContain(
      DOC_EDITED_EVENT_TYPE,
    );
  });
});

/**
 * CONTRACT-031: the other half of §4's rider — the `close` path made into a
 * call. CONTRACT-028 declared no such route on the premise that §7's edit-lock
 * release already signalled a reader close; SERVER-052 measured that against the
 * shipped editor (lease dropped on blur and after ten seconds of not typing,
 * against the session's three minutes) and disproved it.
 *
 * The prose assertions below are not decoration. UI-044 will write its
 * reader-close path against the generated document alone, and the two things it
 * must not have to discover by experiment are whether a duplicate call is safe
 * and whether the route survives a page unload.
 */
describe("the edit-session flush (CONTRACT-031)", () => {
  const FLUSH_PATH = "/api/docs/{id}/edit-session/flush";

  it("adds exactly one endpoint to the inventory", () => {
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("edit-session"))).toEqual([
      "POST /api/docs/{id}/edit-session/flush",
    ]);
  });

  it("requires the workspace bearer token and declares only the codes a flush can produce", () => {
    const op = operation(FLUSH_PATH, "post");
    expect(op.security).toBeUndefined();
    expect(Object.keys(op.responses ?? {})).toEqual(["204", "400", "401", "404"]);
  });

  /**
   * A `204` with a body would be a contradiction; a `200` with one would invite
   * the client to branch on whether a session was open, which is a race against
   * the inactivity timer and, worse, is not yet decided when the response is
   * written (a session with an empty path-scoped range emits nothing).
   */
  it("answers 204 with no content, so there is nothing to branch on", () => {
    const success = operation(FLUSH_PATH, "post").responses?.["204"];
    expect(success?.content).toBeUndefined();
    expect(success?.description).toContain("postcondition");
    expect(operation(FLUSH_PATH, "post").responses?.["200"]).toBeUndefined();
  });

  it("takes the document id and nothing else — no body, no query, no header", () => {
    const op = operation(FLUSH_PATH, "post");
    expect(op.parameters?.map((entry) => `${entry.in}:${entry.name}`)).toEqual(["path:id"]);
    expect(op.requestBody).toBeUndefined();
  });

  it("states that a flush with no open session is a no-op rather than an error", () => {
    const description = operation(FLUSH_PATH, "post").description ?? "";
    expect(description).toContain("Idempotent");
    expect(description).toContain("The answer is `204` whether or not a session was open");
    expect(description).toContain("is a no-op");
  });

  /**
   * The reachability answer, published rather than left to be found at
   * implementation time: `keepalive` works and `sendBeacon` does not, and the
   * reason is the bearer header rather than the method or the body.
   */
  it("says which unload-path spelling works, and why the other does not", () => {
    const description = operation(FLUSH_PATH, "post").description ?? "";
    expect(description).toContain("keepalive: true");
    expect(description).toContain("navigator.sendBeacon");
    expect(description).toContain("sets no request headers at all");
    expect(description).toContain("pagehide");
  });

  it("carries CONTRACT-028's one-event-per-session invariant onto the flush path", () => {
    const description = operation(FLUSH_PATH, "post").description ?? "";
    expect(description).toContain("whichever fires first removes it");
    expect(description).toContain("At most one `doc.edited` may ever exist per `sessionId`");
    expect(description).toContain('endedBy: "close"');
  });

  it("reserves its 404 for an unknown document, like every other route on a document", () => {
    const description = operation(FLUSH_PATH, "post").description ?? "";
    expect(description).toContain(
      "**The `404` means the document is unknown, and it is the only one**",
    );
    expect(description).toContain("never *no session here*");
  });

  /**
   * §4's surface is two routes, and the registry keeps them adjacent — which is
   * also the path order of the generated document, so a reader of the document
   * alone finds the acknowledgment and its escalation together.
   */
  it("sits beside the diff route it shares SPEC.md §4 with", () => {
    const paths = Object.keys(document.paths ?? {});
    expect(paths.indexOf(FLUSH_PATH)).toBe(paths.indexOf("/api/docs/{id}/diff") + 1);
  });
});

/**
 * CONTRACT-011: the extra-frontmatter surface and the first-class §11 view
 * keys. The schema descriptions here ARE the plugin contract — a plugin author
 * reads only the generated document — so these invariants pin the published
 * prose, not just the shapes.
 */
/**
 * CONTRACT-037 — the contract half of SPEC.md §4's "One action, one commit"
 * (rider signed 2026-08-05) and §11's bulk actions on a selection; CONTRACT-048
 * for the staged-set request shape SHARED-032 (signed 2026-08-09) requires. Each
 * property below is one a careless later edit would break silently, and the
 * failure would only surface as a history that disagrees with what the user was
 * told.
 */
describe("one action, one commit (CONTRACT-037, CONTRACT-048)", () => {
  const BULK_PATH = "/api/docs/bulk";
  const bulk = () => operation(BULK_PATH, "post");
  const requestSchema = () => componentSchemas?.["BulkActionRequest"];
  const resultSchema = () => componentSchemas?.["BulkActionResult"];
  const entrySchema = () => componentSchemas?.["BulkStagedEntry"];
  const wholeResultSetSchema = () => componentSchemas?.["BulkWholeResultSetEntry"];
  const actionSchema = () => entrySchema()?.properties?.["action"];

  it("adds exactly one endpoint to the inventory", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/docs/bulk");
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("bulk"))).toHaveLength(1);
  });

  /**
   * The single-document routes are unchanged — they stay the path for the
   * reader's ⋯ menu and the per-row quick actions (§11). Pinned here because
   * "add a batch route" is exactly the change that tempts someone to fold the
   * singles into it.
   */
  it.each([
    ["/api/docs/{id}", "put"],
    ["/api/docs/{id}", "delete"],
    ["/api/docs/{id}/move", "post"],
    ["/api/docs/{id}/archive", "post"],
    ["/api/docs/{id}/unarchive", "post"],
  ])("leaves the single-document route %s %s in place", (path, method) => {
    expect(ENDPOINT_INVENTORY).toContain(endpointSignature(method, path));
    expect(operation(path, method).responses?.["200"]).toBeDefined();
  });

  /**
   * The commit rule is what the route exists for, and the contract cannot
   * enforce it — so the description is where the server implementation reads it,
   * and these assertions are what keep it there. Both directions of §4's
   * no-folding rule are pinned, because they are different mechanisms and
   * dropping either erases the action from the history *as an act*.
   */
  it("states the one-commit rule, in both its directions, on the route itself", () => {
    const description = bulk().description ?? "";
    expect(description).toContain("single auto-commit");
    expect(description).toContain("one commit, not twenty");
    expect(description).toContain("never folds into a preceding editing session");
    expect(description).toContain("no later save folds into it");
    // A server that loops the single-document write path is visibly wrong.
    expect(description).toContain("loops the single-document write path");
  });

  /**
   * CONTRACT-048. §4's amended text is explicit that a mixed Save is still one
   * commit, and the obvious server shortcut — group the staged set by verb and
   * write each group — produces the same files and the wrong history. The route
   * is where that is ruled out, because the contract cannot enforce it.
   */
  it("says a mix of verbs is still one act and still one commit", () => {
    const description = bulk().description ?? "";
    expect(description).toContain("still one act and still one commit");
    expect(description).toContain("not one commit per verb");
    expect(description).toContain("grouping the staged set by verb");
  });

  /**
   * The invariant is directional, and the direction is the whole point: the only
   * way the report can be wrong is by naming a document the commit does not
   * carry. The converse — that the commit carries nothing else — is false, and
   * the contract published it as an equality until PR #37's review found the
   * second counter-example. Both are pinned here, so restoring the tidier claim
   * fails a test rather than a reader.
   */
  it("states the commit containment in the one direction that holds", () => {
    const description = bulk().description ?? "";
    expect(description).toContain("git show --name-only");
    expect(description).toContain("has a file in that commit");
    expect(description).toContain("in one direction only");
    expect(description).not.toContain("are the same set");
    expect(resultSchema()?.properties?.["changed"]?.description).toContain(
      "has a file in `commit`",
    );
  });

  /** Both exceptions, because they follow from one rule and neither is obvious at a call site. */
  it("names both ways the commit carries a file the act did not name", () => {
    const description = bulk().description ?? "";
    expect(description).toContain("partition the **requested** ids");
    expect(description).toContain("anchor cascade");
    expect(description).toContain("nested skill");
    const changed = resultSchema()?.properties?.["changed"]?.description ?? "";
    expect(changed).toContain("did not name");
  });

  /**
   * CONTRACT-048: the staged set, not one verb over many ids. `entries` carries
   * `{id, action}` pairs, so a mixed Save is one request and therefore one
   * commit. `wholeResultSet` is optional and singular; "nothing staged" is a
   * refinement rather than a `minItems`, because an empty `entries` is legal
   * exactly when that entry is present.
   */
  it("carries a list of staged rows and at most one whole-result-set entry", () => {
    expect(Object.keys(requestSchema()?.properties ?? {})).toEqual(["entries", "wholeResultSet"]);
    expect(requestSchema()?.required).toEqual(["entries"]);
    expect(requestSchema()?.additionalProperties).toBe(false);
    expect(requestSchema()?.properties?.["entries"]?.type).toBe("array");
    expect(requestSchema()?.properties?.["entries"]?.items?.$ref).toBe(
      "#/components/schemas/BulkStagedEntry",
    );
    // Singular, so "at most one" needs no rule anyone has to remember.
    expect(requestSchema()?.properties?.["wholeResultSet"]?.$ref).toBe(
      "#/components/schemas/BulkWholeResultSetEntry",
    );
    expect(requestSchema()?.properties?.["wholeResultSet"]?.type).toBeUndefined();
    expect(bulk().requestBody?.required).toBe(true);
  });

  /**
   * Each row names its document and its own act — the pair SHARED-032's per-row
   * staged action needs, and the pair `{ids, action}` could not say.
   */
  it("pairs each staged id with its own act", () => {
    expect(Object.keys(entrySchema()?.properties ?? {})).toEqual(["id", "action"]);
    expect(entrySchema()?.required).toEqual(["id", "action"]);
    expect(entrySchema()?.additionalProperties).toBe(false);
    expect(entrySchema()?.properties?.["id"]?.pattern).toBe("^(doc|th)_[A-Za-z0-9]+$");
    expect(entrySchema()?.properties?.["action"]?.oneOf).toHaveLength(8);
    // The request no longer has one verb for the whole call.
    expect(requestSchema()?.properties?.["action"]).toBeUndefined();
    expect(requestSchema()?.properties?.["ids"]).toBeUndefined();
  });

  /**
   * §11's one selection that has no enumerated form: "a whole-result-set
   * selection stages as a single entry … carrying one action for all of them",
   * with "the count re-evaluated when the Save runs". Ids remain the shape of a
   * staged row; this is the narrow exception, not a filter-shaped mutation.
   */
  it("expresses a whole-result-set selection as one entry carrying a query", () => {
    expect(Object.keys(wholeResultSetSchema()?.properties ?? {})).toEqual(["query", "action"]);
    expect(wholeResultSetSchema()?.required).toEqual(["query", "action"]);
    expect(wholeResultSetSchema()?.additionalProperties).toBe(false);
    // The same flat parameter map a `type: view` document stores, not a second
    // filter grammar that could drift from `GET /api/docs`.
    expect(wholeResultSetSchema()?.properties?.["query"]?.type).toBe("object");
    expect(wholeResultSetSchema()?.properties?.["query"]?.description).toContain(
      "`type: view` document stores",
    );
    const description = bulk().description ?? "";
    expect(description).toContain("re-evaluated when the Save runs");
    expect(description).toContain("except** the ids `entries` names individually");
  });

  /**
   * §11: "Bulk delete is offered **only** on a selection whose documents are
   * enumerated — a whole-result-set selection cannot be deleted." Published as a
   * narrower union, so it is a type error in the generated client rather than a
   * refusal discovered after confirming on 412 documents.
   */
  it("makes `delete` inexpressible on a whole-result-set entry", () => {
    const acts = wholeResultSetSchema()?.properties?.["action"]?.oneOf ?? [];
    expect(acts.flatMap((branch) => branch.properties?.["action"]?.enum ?? [])).toEqual([
      "archive",
      "unarchive",
      "resolve",
      "reopen",
      "move",
      "tag",
      "review",
    ]);
    // Still expressible on an enumerated row, which is what §11 allows.
    expect(actionSchema()?.oneOf?.at(-1)?.properties?.["action"]?.enum).toEqual(["delete"]);
  });

  it("offers the eight acts as one discriminated union, inline rather than named", () => {
    const branches = actionSchema()?.oneOf ?? [];
    expect(branches).toHaveLength(8);
    expect(branches.flatMap((branch) => branch.properties?.["action"]?.enum ?? [])).toEqual([
      "archive",
      "unarchive",
      "resolve",
      "reopen",
      "move",
      "tag",
      "review",
      "delete",
    ]);
    // Not a registered component: a `oneOf` has no `type: "object"`, and the
    // named-component invariant above is the guard against a derived schema
    // rewriting a shared one.
    expect(componentSchemas?.["BulkAction"]).toBeUndefined();
  });

  it("keeps every act's own parameters strict", () => {
    for (const branch of actionSchema()?.oneOf ?? []) {
      expect(branch.additionalProperties).toBe(false);
    }
  });

  /**
   * §11: tagging "adds or removes the named tags and never replaces a document's
   * tag set". The published shape has to make the replacement *inexpressible* —
   * a `tags` key here would flatten twenty different tag sets into one, and no
   * response could report that.
   */
  it("publishes tagging as a delta with no way to spell a replacement", () => {
    const branches = actionSchema()?.oneOf ?? [];
    const tag = branches.find((branch) => branch.properties?.["action"]?.enum?.[0] === "tag");
    expect(Object.keys(tag?.properties ?? {})).toEqual(["action", "add", "remove"]);
    for (const branch of branches) {
      for (const forbidden of ["tags", "set", "replace"]) {
        expect(branch.properties?.[forbidden], forbidden).toBeUndefined();
      }
    }
  });

  it("states §11's three parts as three separate, always-present lists", () => {
    const parts = [
      "changed",
      "alreadyInState",
      "refused",
      "orphanedThreadIds",
      "commit",
      "warnings",
    ];
    expect(Object.keys(resultSchema()?.properties ?? {})).toEqual(parts);
    expect(resultSchema()?.required).toEqual(parts);
    // CONTRACT-048: the single top-level `action` echo is gone. A Save carries a
    // mix of verbs (§4), so one verb for the whole result would have been a lie;
    // the verb moved onto each named document instead.
    expect(resultSchema()?.properties?.["action"]).toBeUndefined();
  });

  it("says an already-archived document is a no-op and not a failure", () => {
    expect(resultSchema()?.properties?.["alreadyInState"]?.description).toContain("not a failure");
  });

  /**
   * A count alone is not a result: the part worth re-reading is the part that
   * did not happen. Each name carries its verb too (CONTRACT-048), so a mixed
   * Save's report reads on its own — including for the documents a
   * `wholeResultSet` entry covered, which the caller never enumerated and has no
   * request row to pair against.
   */
  it("names documents individually in every part, each with the verb that applied", () => {
    for (const part of ["changed", "alreadyInState"]) {
      expect(resultSchema()?.properties?.[part]?.items?.$ref, part).toBe(
        "#/components/schemas/BulkActionOutcome",
      );
    }
    expect(resultSchema()?.properties?.["refused"]?.items?.$ref).toBe(
      "#/components/schemas/BulkActionRefusal",
    );
    const outcome = componentSchemas?.["BulkActionOutcome"];
    expect(Object.keys(outcome?.properties ?? {})).toEqual(["id", "action"]);
    expect(outcome?.required).toEqual(["id", "action"]);
    expect(outcome?.properties?.["id"]?.pattern).toBe("^(doc|th)_[A-Za-z0-9]+$");
    expect(outcome?.properties?.["action"]?.enum).toEqual([...BULK_ACTION_NAMES]);
  });

  it("requires a reason and a message on every refusal, and nothing else", () => {
    const refusal = componentSchemas?.["BulkActionRefusal"];
    expect(refusal?.required).toEqual(["id", "action", "reason", "message"]);
    expect(refusal?.properties?.["reason"]?.enum).toEqual([
      "stale",
      "not-found",
      "not-applicable",
      "invalid",
      "write-failed",
    ]);
    expect(refusal?.properties?.["message"]?.type).toBe("string");
  });

  /**
   * The holder went with the lock (SHARED-041): a `stale` refusal has nobody to
   * name, because nothing is held. Pinned from the published document because
   * the field's absence is what tells a client there is no banner to render.
   */
  it("carries no holder on a refusal, since nothing is ever held", () => {
    expect(componentSchemas?.["BulkActionRefusal"]?.properties?.["lock"]).toBeUndefined();
  });

  /**
   * One sha for the whole act. A server that produced N commits would have
   * nothing honest to put here — which is the point of the field being singular,
   * and of it being nullable rather than absent when nothing changed.
   */
  it("reports one commit, nullable and never a list", () => {
    const commit = resultSchema()?.properties?.["commit"];
    expect(commit?.type).toEqual(["string", "null"]);
    expect(commit?.items).toBeUndefined();
    expect(commit?.description).toContain("never a list");
  });

  it("totals the threads a bulk delete orphaned", () => {
    const orphaned = resultSchema()?.properties?.["orphanedThreadIds"];
    expect(orphaned?.items?.pattern).toBe("^th_[A-Za-z0-9]+$");
    expect(orphaned?.description).toContain("orphaned records");
  });

  /**
   * Partial failure is the normal case, not the error path: a document whose
   * content moved and an unknown id are per-document outcomes here, so neither
   * becomes a verdict on the request. Declaring `404` would invite exactly the
   * all-or-nothing server §11 forbids.
   */
  it("declares no 404, and says why", () => {
    const responses = bulk().responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "401", "403"]);
    expect(bulk().description).toContain("There is no `404`");
  });

  it("carries the acting party like every other mutation", () => {
    const header = bulk().parameters?.find((entry) => entry.in === "header");
    expect(header?.name).toBe(ACTOR_HEADER);
    expect(header?.schema?.enum).toEqual([...ACTORS]);
  });

  /**
   * CONTRACT-048. Both refusals are refinements — invisible in the JSON Schema —
   * so the published prose is the only place a client reads them, and the only
   * place a reviewer can check that last-write-wins was rejected on purpose.
   */
  it("publishes both ways a staged set is refused outright, and why", () => {
    const description = bulk().description ?? "";
    expect(description).toContain("nothing staged at all");
    expect(description).toContain("one id staged twice");
    expect(description).toContain("choosing one silently would");
    const entries = requestSchema()?.properties?.["entries"]?.description ?? "";
    expect(entries).toContain("An id may appear at most once");
    expect(entries).toContain("refused naming both");
  });
});

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

/**
 * CONTRACT-040. The count that lets a reason chip say "2 still open" (SPEC.md
 * §11) from the collection response alone. Like `unreadThreads`, its description
 * is the whole contract the server half implements against, so it is pinned in
 * the published document rather than only inferred from the type.
 */
describe("DocRow.unansweredForms (CONTRACT-040)", () => {
  const property = () => componentSchemas?.["DocRow"]?.properties?.["unansweredForms"];

  it("is a required, non-negative integer — never nullable, never absent", () => {
    expect(componentSchemas?.["DocRow"]?.required).toContain("unansweredForms");
    expect(property()?.type).toBe("integer");
    expect(property()?.minimum).toBe(0);
    expect(JSON.stringify(property())).not.toContain('"null"');
  });

  /**
   * The equivalence with the `form` reason is the field's reason to exist, and
   * an equivalence published without its direction is what two review rounds
   * caught this week — so the published prose has to state both halves.
   */
  it("publishes the equivalence with the `form` reason in both directions", () => {
    const description = JSON.stringify(property());
    expect(description).toContain("both directions");
    expect(description).toContain("iff");
    expect(description).toContain("Left to right");
    expect(description).toContain("right to left");
  });

  it("publishes the resolve rule, the seen asymmetry, and that 0 is not `unknown`", () => {
    const description = JSON.stringify(property());
    expect(description).toContain("SPEC.md §6, §11");
    expect(description).toContain("Resolving the thread takes it to `0`");
    expect(description).toContain("/seen");
    expect(description).toContain("non-thread row");
    expect(description).toContain("unknown");
  });

  /**
   * The alternative this field was chosen over: widening `attention`'s entries
   * into objects. A published `attention` whose items stopped being the reason
   * enum would break every consumer of every reason for one reason's sake.
   */
  it("leaves `attention` an array of bare reason codes", () => {
    const attention = componentSchemas?.["DocRow"]?.properties?.["attention"];
    expect(attention?.type).toBe("array");
    expect(attention?.items?.type).toBe("string");
    expect(attention?.items?.enum).toContain("form");
    expect(attention?.items?.properties).toBeUndefined();
  });
});

describe("author attribution", () => {
  /**
   * The `POST`s with no git author to attribute, and they are unattributed for
   * different reasons — which is why this is a named set rather than a
   * predicate over the path.
   *
   * - `POST /api/check` is a `POST` because a request body is the only way to
   *   say what to check, not because anything is written: it runs the validator
   *   and mutates nothing (SPEC.md §14).
   * - `POST /api/index/rebuild` genuinely mutates — but only **derived runtime
   *   state**, the semantic index inside the projection, which is not a
   *   workspace file and never reaches git (SPEC.md §9.2: "Both touch only
   *   derived runtime state — no workspace file changes, no git commit, no
   *   acting party"). Its projection-wide counterpart `POST /api/db/rebuild`
   *   *does* carry the header, and the pair is the clearest statement of what
   *   the header is for.
   *
   * - `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031) writes no
   *   workspace file either: it ends an in-memory edit session and lets the
   *   acknowledgment for it be enqueued. The commits that session is *about*
   *   landed minutes earlier, on the editor's own save path, already authored by
   *   the user — and the event's own actor is fixed by its payload schema
   *   (`actor: "user"`, always), so the caller could not change the attribution
   *   even by naming itself.
   *
   * - `POST /api/upgrade` (CONTRACT-027) is the odd one out, and the only one
   *   where a commit really does follow: SPEC.md §2.4's upgrade syncs the
   *   workspace's template files and lands them in "a single attributed
   *   commit". It is exempt because of *who* commits. The server's entire
   *   contribution is `spawn`; the writes happen in a detached process, minutes
   *   later, after a download, and after this server has been stopped and
   *   replaced — the upgrade restarts it, so it must outlive it. The header
   *   exists so that a request's caller becomes the git author of the commit
   *   *that request* makes (§9.2), and this request makes none. Declaring it
   *   would publish an input this server cannot honour and the committing
   *   process is not bound by. It stays additive if a later revision wires the
   *   attribution through to the spawn.
   *
   * In every case declaring the header would advertise a commit that this
   * request never makes.
   */
  const UNATTRIBUTED_POSTS = new Set([
    "POST /api/check",
    "POST /api/index/rebuild",
    "POST /api/docs/{id}/edit-session/flush",
    "POST /api/upgrade",
  ]);

  it("declares the optional actor header on every mutating operation", () => {
    const problems: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (!op || UNATTRIBUTED_POSTS.has(endpointSignature(method, path))) continue;
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
   * The exemption list is the interesting half of the rule, so it is asserted
   * from the other side too: an exempt operation must genuinely declare no
   * header at all, rather than the set becoming a place to park a route that
   * merely forgot one.
   */
  it.each([...UNATTRIBUTED_POSTS])("exempts %s by declaring no header at all", (entry) => {
    const [, path] = entry.split(" ");
    const op = operation(path ?? "", "post");
    expect(op.parameters?.some((parameter) => parameter.in === "header")).toBeFalsy();
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
    // CONTRACT-037: the bulk route declares `403` for one of its eight acts —
    // `delete` keeps §9.2's user-only rule, and the refusal is the request's.
    ["/api/docs/bulk", "post"],
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

/**
 * CONTRACT-033, the wire half of SHARED-015. SPEC.md §7: "Claiming work also
 * reports the events the server currently holds `in-progress`, each with what it
 * is and how long it has been held… Reconciliation is the agent's judgement and
 * never an inference the server draws on its behalf."
 *
 * What is pinned in the *published document* rather than in the schema tests is
 * everything a client author learns without opening this package: the shape, the
 * cap and its signal, and the prose that makes the list actionable — above all
 * the never-settle-what-you-cannot-account-for clause, which is the one rule
 * whose absence turns this feature into a way to kill a concurrent run's work.
 */
describe("the in-progress set reported on a claim (CONTRACT-033)", () => {
  const CLAIM_PATH = "/api/queue/claim-all";

  it("adds no endpoint: the report rides on the loop's existing entry points", () => {
    expect(operations()).toEqual([...ENDPOINT_INVENTORY].sort());
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("in-progress"))).toEqual([]);
  });

  it("publishes the held event with what it is, where it came from, and since when", () => {
    const schema = componentSchemas?.["InProgressEvent"];
    expect(Object.keys(schema?.properties ?? {})).toEqual([
      "id",
      "type",
      "heldSince",
      "originId",
      "originTitle",
    ]);
    expect(schema?.required).toEqual(["id", "type", "heldSince", "originId", "originTitle"]);
  });

  /**
   * The instant-not-duration decision, published where a client author reads it:
   * a `date-time` string, with the reason for it in the description rather than
   * only in the source docblock.
   */
  it("types the held-since as an instant and says why it is not a duration", () => {
    const heldSince = componentSchemas?.["InProgressEvent"]?.properties?.["heldSince"];
    expect(JSON.stringify(heldSince)).toContain("date-time");
    expect(heldSince?.description).toContain("not how long ago that was");
    expect(heldSince?.description).toContain("whichever clock it trusts");
  });

  /**
   * The origin is `Job`'s, spelling and nullability both — the rider asked for
   * one vocabulary for "where this came from", not a second one.
   */
  it("says where a held event came from the way a job does", () => {
    const held = componentSchemas?.["InProgressEvent"];
    const job = componentSchemas?.["Job"];
    for (const field of ["originId", "originTitle"] as const) {
      expect(JSON.stringify(held?.properties?.[field]), field).toContain('"null"');
      expect(JSON.stringify(job?.properties?.[field]), field).toContain('"null"');
    }
    expect(held?.properties?.["originId"]?.description).toContain("`Job.originId`");
  });

  /**
   * The cap is only acceptable because it announces itself. `maxItems` publishes
   * the bound, `total` publishes the real size, and `truncated` is the flag that
   * stops a capped list reading as a complete one — the CONTRACT-030 precedent,
   * on this very route.
   */
  it("publishes the cap and both halves of its overflow signal", () => {
    const set = componentSchemas?.["InProgressSet"];
    expect(Object.keys(set?.properties ?? {})).toEqual(["events", "total", "truncated"]);
    expect(set?.required).toEqual(["events", "total", "truncated"]);
    expect(set?.properties?.["events"]?.maxItems).toBe(MAX_IN_PROGRESS_REPORTED);
    expect(set?.properties?.["total"]?.description).toContain("and N more");
    expect(set?.properties?.["total"]?.description).toContain("GET /api/jobs?status=in-progress");
    expect(set?.properties?.["truncated"]?.description).toContain("complete one");
  });

  it("states the ordering the cap depends on", () => {
    expect(componentSchemas?.["InProgressSet"]?.properties?.["events"]?.description).toContain(
      "most recently claimed first",
    );
  });

  /**
   * The separation is the feature. Both bodies carry it as a sibling of
   * `events`, and both require it — an optional field would be
   * indistinguishable from an empty one.
   */
  it.each(["ClaimBatch", "IdleResult"])("gives %s the set as its own required field", (name) => {
    const schema = componentSchemas?.[name];
    expect(Object.keys(schema?.properties ?? {})).toEqual(["events", "inProgress"]);
    expect(schema?.required).toContain("inProgress");
    expect(schema?.properties?.["events"]?.items?.$ref).toContain("QueueEvent");
    // Referenced unmodified: `.describe()` on a registered schema would carry
    // the component's name onto the derived one and rewrite the definition both
    // bodies share, so the reference has to be a bare `$ref`.
    expect(schema?.properties?.["inProgress"]?.$ref).toContain("InProgressSet");
  });

  /**
   * The prose lives on the shared component rather than on each reference, for
   * the reason above — so this is where a client author reads the separation
   * rule and the never-settle clause without opening the route.
   */
  it("carries the reconciliation rule on the component both bodies share", () => {
    const description = componentSchemas?.["InProgressSet"]?.description ?? "";
    expect(description).toContain("never mixed into the claimed events");
    expect(description).toContain("never settle an event you cannot account for");
    expect(description).toContain("settles nothing by itself");
  });

  /** SPEC.md §7's reconciliation rule, published where a client author reads it. */
  it("states the reconciliation contract, including what must never be settled", () => {
    const description = operation(CLAIM_PATH, "post").description ?? "";
    expect(description).toContain("never mixed into `events`");
    expect(description).toContain("cannot account for is never settled");
    expect(description).toContain("concurrent run's work");
    expect(description).toContain("reports, and settles nothing by itself");
    expect(description).toContain("`reap-stale` remains the recovery");
    expect(description).toContain("The list is capped");
  });

  /** The rider's resolved Q1: the two entry points, and only those. */
  it("reports it on idle too, and says the 204 cannot carry it", () => {
    const description = operation("/api/queue/idle", "get").description ?? "";
    expect(description).toContain("the loop's two entry points");
    expect(description).toContain("`204` that ends an empty window has no body");
  });
});

/**
 * CONTRACT-021, the wire half of SERVER-030. SPEC.md §7 promises a "dedicated
 * defer/requeue queue state that re-enters automatically on lock release", and
 * everything pinned here is that sentence and nothing more: one status, the
 * document it waits on, and the counts and prose that keep a deferral from
 * reading as a failure.
 */
describe("the deferred queue state (CONTRACT-021)", () => {
  const DEFER_PATH = "/api/queue/{id}/defer";

  it("adds one endpoint, and it is a queue verb", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/queue/{id}/defer");
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("defer"))).toHaveLength(1);
  });

  it("adds exactly one status to §7's set and reorders none of the rest", () => {
    expect([...QUEUE_EVENT_STATUSES]).toEqual([
      "pending",
      "in-progress",
      "deferred",
      "processed",
      "failed",
      "abandoned",
    ]);
    expect(componentSchemas?.["Job"]?.properties?.["status"]?.enum).toEqual([
      ...QUEUE_EVENT_STATUSES,
    ]);
  });

  /**
   * The one fact a consumer cannot read off the enum — which values are
   * terminal — and the one it must not get wrong, since rendering `deferred` as
   * a failure is the state of the world this issue exists to change.
   */
  it("publishes the deferred state as neither terminal nor claimable", () => {
    const description = JSON.stringify(componentSchemas?.["Job"]?.properties?.["status"]);
    expect(description).toContain("terminal");
    expect(description).toContain("not claimable, not failed");
    expect(description).toContain("returns to `pending` automatically when that session ends");
  });

  it("counts deferrals separately from failures on the console strip's status", () => {
    const status = componentSchemas?.["QueueStatus"];
    expect(Object.keys(status?.properties ?? {})).toEqual([
      "halted",
      "pending",
      "inProgress",
      "deferred",
      "processed",
      "failed",
      "abandoned",
    ]);
    expect(status?.required).toContain("deferred");
    expect(JSON.stringify(status?.properties?.["deferred"])).toContain("not a failure");
  });

  it("declares only the codes a deferral can produce", () => {
    expect(Object.keys(operation(DEFER_PATH, "post").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "404",
      "409",
    ]);
  });

  /**
   * The blocking document is mandatory because automatic re-entry has nothing
   * to key off without it, and it is in the body because no payload shape
   * carries it for every event type — `form.respond` names no document at all.
   */
  it("demands the blocking document and nothing else", () => {
    const schema = componentSchemas?.["DeferEventRequest"];
    expect(Object.keys(schema?.properties ?? {})).toEqual(["blockedOn", "reason"]);
    expect(schema?.required).toEqual(["blockedOn"]);
    expect(schema?.additionalProperties).toBe(false);
    expect(operation(DEFER_PATH, "post").requestBody?.required).toBe(true);
  });

  it("says why the body cannot be omitted, since every other queue annotation may be", () => {
    expect(operation(DEFER_PATH, "post").requestBody?.description).toContain(
      "A deferral that named no document could never re-enter",
    );
  });

  it("carries the acting party, like every other queue transition", () => {
    const header = operation(DEFER_PATH, "post").parameters?.find(
      (entry) => entry.in === "header" && entry.name === ACTOR_HEADER,
    );
    expect(header?.required).toBe(false);
  });

  /** §7's three properties, published where a client author reads them. */
  it("states automatic re-entry, non-claimability and never-silently-dropped", () => {
    const description = operation(DEFER_PATH, "post").description ?? "";
    expect(description).toContain("waiting, not failed");
    expect(description).toContain("The end of that edit session");
    expect(description).toContain("`claim-all` skips deferred events");
    expect(description).toContain("Nothing is ever silently dropped");
    expect(description).toContain("survives a restart");
  });

  /**
   * There is deliberately no re-entry route: re-entry is the server's own
   * reaction to an edit session ending. `job retry` stays the manual override,
   * and says so.
   */
  it("adds no route for the reverse transition, and names the manual override", () => {
    expect(ENDPOINT_INVENTORY.filter((entry) => entry.includes("requeue"))).toEqual([]);
    const retry = operation("/api/jobs/{id}/retry", "post");
    expect(retry.summary).toContain("deferred");
    expect(retry.description).toContain("manual override");
  });

  it("gives the console the blocking document and its live title", () => {
    const job = componentSchemas?.["Job"];
    for (const field of ["blockedOn", "blockedOnTitle"]) {
      expect(job?.required, field).toContain(field);
      expect(JSON.stringify(job?.properties?.[field]), field).toContain('"null"');
    }
    expect(JSON.stringify(job?.properties?.["blockedOn"])).toContain(
      "non-null exactly when `status` is `deferred`",
    );
  });

  /** The invalidation story has to name the new emitters, or the console only sees it on refetch. */
  it("names defer and what re-enters a deferral among the queue key's emitters", () => {
    const description = operation("/events", "get").description ?? "";
    expect(description).toContain("complete, fail, defer, abandon");
    expect(description).toContain("the end of an edit session that re-enters a deferred event");
  });
});

/**
 * SPEC.md §7 "A key, not a lock" (CONTRACT-049, rider SHARED-041 signed
 * 2026-08-11) — as the published document states it.
 *
 * The removal is asserted as a *removal*: a lock that survives anywhere is a
 * lock that can still be forgotten, and the failure of the old mechanism was
 * that nothing in the write path required it. So this pins the absence of every
 * piece of it alongside the presence of the key.
 */
describe("a key on every read, and on every write that overwrites", () => {
  const KEY_PATTERN = "^[0-9a-f]{64}$";

  it("carries the key and the editing signal on every whole document", () => {
    const doc = componentSchemas?.["Doc"];
    expect(doc?.required).toContain("key");
    expect(doc?.required).toContain("userEditing");
    expect(doc?.properties?.["key"]?.pattern).toBe(KEY_PATTERN);
    expect(doc?.properties?.["userEditing"]?.type).toBe("boolean");
  });

  /**
   * Every route that answers with a whole document answers with a key, because
   * the key lives on `Doc` rather than beside it — a writer reads the next key
   * off the document its own write returned, and never has to re-read.
   */
  it.each([
    ["/api/docs/{id}", "get", "200"],
    ["/api/docs/{id}", "put", "200"],
    ["/api/docs", "post", "201"],
    ["/api/docs/{id}/move", "post", "200"],
    ["/api/docs/{id}/archive", "post", "200"],
    ["/api/docs/{id}/unarchive", "post", "200"],
    ["/api/docs/{id}/patch", "post", "200"],
  ])("hands a key back from %s %s", (path, method, status) => {
    const named = JSON.stringify(operation(path, method).responses?.[status]).match(
      /#\/components\/schemas\/(\w+)/,
    )?.[1];
    expect(named).toBeDefined();
    // Either the response *is* a document, or it wraps one — and the wrapper
    // reaches `Doc`, which is the only place a key is published.
    const reachesDoc =
      named === "Doc" ||
      JSON.stringify(componentSchemas?.[named ?? ""]).includes('"#/components/schemas/Doc"');
    expect(reachesDoc, named).toBe(true);
  });

  /**
   * The set is closed from the other side too: every response in the whole
   * surface that carries a document carries a key, because there is exactly one
   * shape for a whole document and the key is on it.
   */
  it("has one shape for a whole document, and the key lives on it", () => {
    const DOC_REF = '"#/components/schemas/Doc"';
    const carriers = Object.entries(componentSchemas ?? {})
      .filter(([name, schema]) => name !== "Doc" && JSON.stringify(schema).includes(DOC_REF))
      .map(([name]) => name);
    expect(carriers.sort()).toEqual([
      "DocMutationResponse",
      "PatchDocResponse",
      "StaleKeyError",
      "UpdateDocResponse",
    ]);
  });

  /**
   * A list row carries no body, so there is no version of one to have read. A
   * key there would let a caller write a document it never opened.
   */
  it("puts no key on a list row", () => {
    const row = componentSchemas?.["DocRow"];
    expect(row?.properties?.["key"]).toBeUndefined();
    expect(row?.properties?.["userEditing"]).toBeUndefined();
  });

  /**
   * The distinction §7 draws, published rather than left to a server comment:
   * `dependentRequired` says *a body write must carry a key* in JSON Schema
   * itself, so a reader of `openapi.json` alone learns the rule. The runtime
   * refusal is a `400` from the same schema, before any handler runs.
   */
  it("requires the key exactly when the write replaces the body", () => {
    const update = componentSchemas?.["UpdateDocRequest"];
    expect(update?.dependentRequired).toEqual({ body: ["key"] });
    expect(update?.required).toBeUndefined();
    expect(update?.properties?.["key"]?.pattern).toBe(KEY_PATTERN);
  });

  it("says which writes need one and which name their own delta", () => {
    const description = operation("/api/docs/{id}", "put").description ?? "";
    expect(description).toContain("must present the document's `key`");
    expect(description).toContain("names its own delta needs none");
  });

  /** The key is opaque: the published document must not hand a client the recipe. */
  it("publishes the opacity rules without publishing the derivation", () => {
    const description = componentSchemas?.["Doc"]?.properties?.["key"]?.description ?? "";
    expect(description).toContain("opaque");
    expect(description).toContain("Never compute");
    for (const leak of ["SHA-256", "sha256", "digest", "hash"]) {
      expect(description, leak).not.toContain(leak);
    }
  });

  /**
   * A refusal is never bare (SHARED-041 decision 5): one round trip, not two.
   * The fresh key is `doc.key` rather than a sibling field, so two copies can
   * never disagree about which version it names.
   */
  it("refuses a stale key with 409, carrying the document and its fresh key", () => {
    const refusal = operation("/api/docs/{id}", "put").responses?.["409"];
    expect(JSON.stringify(refusal)).toContain("StaleKeyError");
    const shape = componentSchemas?.["StaleKeyError"];
    expect(shape?.required).toEqual(["code", "message", "doc"]);
    expect(shape?.properties?.["code"]?.enum).toEqual(["stale_key"]);
    expect(JSON.stringify(shape?.properties?.["doc"])).toContain("#/components/schemas/Doc");
    expect(shape?.properties?.["key"]).toBeUndefined();
  });

  /**
   * `409` is taken by the re-attach refusal and the patch refusal, and all three
   * must stay tellable apart where clients branch — the `code`, then `reason`.
   * `stale_key` takes the seat `locked` vacated, so `ERROR_CODES` still has
   * seven members: the two state refusals narrow `conflict` with a `reason`
   * rather than each claiming a code of its own, and one `code` never means two
   * things.
   */
  it("gives the three 409s distinguishable codes", () => {
    expect(componentSchemas?.["ReattachConflictError"]?.properties?.["code"]?.enum).toEqual([
      "conflict",
    ]);
    expect(componentSchemas?.["PatchConflictError"]?.properties?.["code"]?.enum).toEqual([
      "conflict",
    ]);
    // Two `conflict` bodies, told apart by a `reason` vocabulary that does not
    // overlap — so a caller that reaches the wrong route's narrowing gets a
    // failed match rather than a plausible wrong answer.
    const reasonsOf = (name: string) =>
      componentSchemas?.[name]?.properties?.["reason"]?.enum ?? [];
    expect(
      reasonsOf("PatchConflictError").filter((reason) =>
        reasonsOf("ReattachConflictError").includes(reason),
      ),
    ).toEqual([]);
    expect(componentSchemas?.["StaleKeyError"]?.properties?.["code"]?.enum).toEqual(["stale_key"]);
    expect([...ERROR_CODES]).toEqual([
      "bad_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "stale_key",
      "internal_error",
    ]);
  });

  /**
   * A write that names its own delta merges with whatever else happened, so it
   * presents nothing — and each route says so, because an omission that reads as
   * an oversight is the one a later change quietly "fixes".
   */
  it.each([
    ["/api/docs/{id}/move", "post"],
    ["/api/docs/{id}/archive", "post"],
    ["/api/docs/{id}/unarchive", "post"],
    ["/api/docs/{id}", "delete"],
    ["/api/threads", "post"],
    ["/api/threads/{id}/turns/{ts}", "delete"],
    ["/api/threads/{id}/reattach", "post"],
    ["/api/docs/{id}/patch", "post"],
  ])("takes no key on %s %s, and says why", (path, method) => {
    const op = operation(path, method);
    expect(op.description).toContain("no key");
    expect(JSON.stringify(op.requestBody ?? {})).not.toContain(KEY_PATTERN);
  });

  /** Nothing is held, so nothing can refuse a write for being held. */
  it("declares 423 on no operation at all", () => {
    const declared: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, Operation> | undefined)?.[method];
        if (op?.responses?.["423"]) declared.push(endpointSignature(method, path));
      }
    }
    expect(declared).toEqual([]);
  });

  it("declares no lock endpoint, and no lock component", () => {
    expect(operations().filter((entry) => entry.includes("lock"))).toEqual([]);
    expect(
      Object.keys(componentSchemas ?? {}).filter((name) => name.toLowerCase().includes("lock")),
    ).toEqual([]);
  });

  /** There is nothing to acquire, release, break or reap — so nothing says there is. */
  it("mentions no lock anywhere in the published document", () => {
    const published = JSON.stringify(document);
    for (const word of ['"locked"', "edit lock", "force unlock", "/api/locks"]) {
      expect(published, word).not.toContain(word);
    }
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
    ["/api/jobs", "get"],
    ["/api/jobs/{id}/log", "get"],
    ["/api/threads/{id}", "get"],
  ])("declares no 409 on the read-only route %s %s", (path, method) => {
    expect(operation(path, method).responses?.["409"]).toBeUndefined();
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
 * the same validator on demand"), and the skill-creation surface §7's genesis
 * clause requires.
 *
 * CONTRACT-008's other half, `POST /api/skills/{name}/rollback`, is **gone**
 * (rider signed 2026-08-12): §7's loop safety is a write whose content came from
 * history, made through `PUT /api/docs/{id}` with a key, so there is no rollback
 * operation left to pin — and the inventory assertion below is what keeps it
 * that way.
 */
describe("the validation and skill surface", () => {
  const CHECK_PATH = "/api/check";

  it("adds the check endpoint to the inventory, and no rollback beside it", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/check");
    expect(ENDPOINT_INVENTORY).not.toContain("POST /api/skills/{name}/rollback");
  });

  /** An ordinary authenticated route: it does not join the §2.1 exception list. */
  it("requires the workspace bearer token on the check", () => {
    expect(operation(CHECK_PATH, "post").security).toBeUndefined();
    expect(operation(CHECK_PATH, "post").responses?.["401"]).toBeDefined();
  });

  it("declares only the codes a check can produce", () => {
    expect(Object.keys(operation(CHECK_PATH, "post").responses ?? {})).toEqual([
      "200",
      "400",
      "401",
    ]);
  });

  /** The removal, asserted as a removal: no path, no schemas, no leftover prose. */
  it("publishes no rollback path and no rollback schemas", () => {
    expect(document.paths?.["/api/skills/{name}/rollback"]).toBeUndefined();
    expect(componentSchemas?.["SkillRollbackRequest"]).toBeUndefined();
    expect(componentSchemas?.["SkillRollbackResult"]).toBeUndefined();
    expect(JSON.stringify(document)).not.toContain("rollback");
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
    it("publishes the closed fourteen-code vocabulary", () => {
      expect(componentSchemas?.["CheckFinding"]?.properties?.["code"]?.enum).toEqual([
        ...CHECK_CODES,
      ]);
      expect(CHECK_CODES).toHaveLength(14);
    });

    it("records the two warning codes, and only those, in the route description", () => {
      const description = operation(CHECK_PATH, "post").description ?? "";
      for (const code of CHECK_WARNING_CODES) expect(description, code).toContain(code);
      expect(description).toContain("The other twelve codes are errors");
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

  /**
   * CONTRACT-020. §7's genesis clause needs a *create* verb, and creation is the
   * one thing about a skill that cannot be an ordinary document call: `POST
   * /api/docs` files under `data/docs/` by construction. What is pinned here is
   * the shape SERVER-036 inherits — including the two facts that are decisions
   * rather than mechanics: the traversal guard lives in the schema, and the
   * archived-name question is left to the server without either answer needing
   * a new response.
   */
  describe("the skill create (CONTRACT-020)", () => {
    const CREATE_PATH = "/api/skills";

    it("adds one endpoint to the inventory, on the collection", () => {
      expect(ENDPOINT_INVENTORY).toContain("POST /api/skills");
    });

    it("declares only the codes a creation can produce, 409 among them and no 423", () => {
      expect(Object.keys(operation(CREATE_PATH, "post").responses ?? {})).toEqual([
        "201",
        "400",
        "401",
        "409",
      ]);
    });

    it("says why it presents no key, so the omission reads as a decision", () => {
      const description = operation(CREATE_PATH, "post").description ?? "";
      expect(description).toContain("It presents no key");
      expect(description).toContain("does not exist until the call succeeds");
    });

    it("names the skill in the body, since the path names no resource yet", () => {
      expect(operation(CREATE_PATH, "post").parameters?.filter((e) => e.in === "path")).toEqual([]);
      expect(componentSchemas?.["SkillCreateRequest"]?.properties?.["name"]).toBeDefined();
    });

    /**
     * The guard is expressible on the wire: one pattern, published, admitting
     * no separator — so a traversal attempt is a `400` on `body.name` rather
     * than something a handler has to remember to check.
     */
    it("publishes the name pattern as the traversal guard", () => {
      expect(componentSchemas?.["SkillCreateRequest"]?.properties?.["name"]).toMatchObject({
        type: "string",
        pattern: SKILL_NAME_PATTERN.source,
      });
      expect(SKILL_NAME_PATTERN.test("../evil")).toBe(false);
    });

    /**
     * The length bound is published rather than only enforced — a client
     * generating a form, or a server translating an `ENAMETOOLONG`, reads it off
     * the document rather than guessing.
     */
    it("publishes the name length bound on the body", () => {
      expect(componentSchemas?.["SkillCreateRequest"]?.properties?.["name"]).toMatchObject({
        maxLength: SKILL_NAME_MAX_LENGTH,
      });
    });

    it("demands the name and the description, and nothing else", () => {
      const schema = componentSchemas?.["SkillCreateRequest"];
      expect(Object.keys(schema?.properties ?? {})).toEqual([
        "name",
        "description",
        "title",
        "body",
        "tags",
      ]);
      expect(schema?.required).toEqual(["name", "description"]);
      expect(schema?.additionalProperties).toBe(false);
    });

    it("states the server-applied title default rather than declaring one", () => {
      const title = componentSchemas?.["SkillCreateRequest"]?.properties?.["title"];
      expect(title?.default).toBeUndefined();
      expect(title?.description).toContain("Defaults to the skill's `name`");
    });

    it("publishes both frontmatter vocabularies, which is what a skill file is", () => {
      const description = operation(CREATE_PATH, "post").description ?? "";
      for (const phrase of ["`name`", "`description`", "`type: skill`", "anchors"]) {
        expect(description, phrase).toContain(phrase);
      }
    });

    it("carries the acting party, since the creation is an auto-commit", () => {
      const header = operation(CREATE_PATH, "post").parameters?.find(
        (entry) => entry.in === "header" && entry.name === ACTOR_HEADER,
      );
      expect(header?.required).toBe(false);
      expect(operation(CREATE_PATH, "post").description).toContain("normal auto-commit");
    });

    it("returns the created skill as an ordinary document", () => {
      expect(JSON.stringify(operation(CREATE_PATH, "post").responses?.["201"])).toContain(
        "DocMutationResponse",
      );
    });

    /**
     * SERVER-036 leaves the archived-name collision open. The response set has
     * to accommodate either ruling without a later contract change, and it does:
     * refusing is the declared `409`, allowing is the declared `201`. The prose
     * says so, so the openness is visible to a client author rather than only
     * to whoever reads the issue files.
     */
    it("leaves the archived-name collision to the server without a third outcome", () => {
      const description = operation(CREATE_PATH, "post").description ?? "";
      expect(description).toContain("skills-archived");
      expect(description).toContain("answered by the server");
      expect(description).toContain("refusing it is this same `409`, allowing it is a plain `201`");
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
    // CONTRACT-041: a re-attach rewrites one `anchors` entry in the **parent
    // document's** frontmatter and auto-commits it, so a rejected hook is
    // exactly as reachable here as it is on a create.
    "ReattachThreadResponse",
    // CONTRACT-037: a bulk act is one auto-commit over many files (SPEC.md §4),
    // so a hook that rejects it leaves every one of them on disk and
    // uncommitted — the widest reach any single `commit_failed` has.
    "BulkActionResult",
    // CONTRACT-046: an applied patch is an ordinary write (SPEC.md §9.2) —
    // validated, reconciled, auto-committed — so it reaches §14's warnings by
    // exactly the routes `UpdateDocResponse` does, and shares its shape.
    "PatchDocResponse",
  ];

  /**
   * Components whose `warnings` is a different vocabulary and must not be held
   * to `Warning`'s shape. `CheckReport.warnings` is the **validator's** severity
   * split — §14's "unresolvable-but-well-formed anchors and unresolved
   * `[[refs]]` are warnings, not failures" — carrying `CheckFinding`s.
   * `/api/check` writes nothing and can produce no commit warning at all, so
   * there is no shape here for `Warning` to occupy.
   *
   * `DoctorReport.warnings` (CONTRACT-025) is the same story for the same
   * reason: doctor opens the database read-only and mutates nothing, so a commit
   * warning is not a thing it can produce. Its list carries `DoctorWarning`s —
   * report-only findings about files the projection will never index — and it is
   * the one carrier here that is optional, because it ships ahead of the server
   * pass that fills it. Both entries are exceptions that had to be **declared**;
   * the test below is what forces the declaration.
   */
  const FOREIGN_WARNINGS = ["CheckReport", "DoctorReport"];

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

  it("keeps the doctor report's warnings its own report-only list", () => {
    expect(componentSchemas?.["DoctorReport"]?.properties?.["warnings"]).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/DoctorWarning" },
    });
  });

  /**
   * The three vocabularies must stay distinguishable by shape alone, so a
   * consumer that gets the wrong one gets a parse error rather than a silently
   * mis-rendered list. `Warning` is keyed by `code`; the other two by `kind`
   * and `severity`/`kind` respectively.
   */
  it("gives each warning vocabulary a shape the others cannot pass for", () => {
    expect(Object.keys(componentSchemas?.["Warning"]?.properties ?? {})).toEqual([
      "code",
      "detail",
    ]);
    expect(componentSchemas?.["DoctorWarning"]?.properties?.["code"]).toBeUndefined();
    expect(componentSchemas?.["Warning"]?.properties?.["kind"]).toBeUndefined();
  });
});

/**
 * CONTRACT-047. A skill folder move carries every `SKILL.md` under the folder,
 * so an act on one skill enables or disables another the request never named
 * (§7) and may correct a stale `status` in its frontmatter (SERVER-078). Both
 * were visible only in the commit and the server log. §4's reporting rule is
 * argued from the inverse case — never record an effect the user was told did
 * not happen — and an effect the user was told *nothing* about fails it for the
 * same reason, so the response now says it.
 *
 * Pinned on the published document rather than on the schema module, because
 * what a client author reads is this document.
 */
describe("a folder move reports the documents it carried (CONTRACT-047)", () => {
  const ARCHIVE = "/api/docs/{id}/archive";
  const UNARCHIVE = "/api/docs/{id}/unarchive";
  const codeSchema = (): SchemaNode | undefined =>
    componentSchemas?.["Warning"]?.properties?.["code"];
  const resultProperties = (): string[] =>
    Object.keys(componentSchemas?.["BulkActionResult"]?.properties ?? {});

  it("publishes the two carried codes in the shared warning vocabulary", () => {
    expect(codeSchema()?.enum).toEqual([...WARNING_CODES]);
    expect(codeSchema()?.enum).toContain("carried_skill");
    expect(codeSchema()?.enum).toContain("carried_reconciliation");
  });

  /**
   * `detail` is prose the contract forbids parsing, so every distinction a
   * client acts on has to be in `code`. A routine carry (§7 working as
   * specified, on every nested skill) and the server rewriting a file the
   * caller never named are different in kind and in rarity; one code for both
   * would leave a console unable to tell them apart.
   */
  it("keeps the carry and the frontmatter rewrite separately addressable", () => {
    const codes: string[] = codeSchema()?.enum ?? [];
    expect(new Set(codes).size).toBe(codes.length);
    const description = codeSchema()?.description ?? "";
    for (const code of WARNING_CODES) expect(description, code).toContain(code);
  });

  it("says in the vocabulary itself what each carried code means and when it is silent", () => {
    const description = codeSchema()?.description ?? "";
    expect(description).toContain("did not itself archive or unarchive");
    expect(description).toContain("SPEC.md §7");
    // The direction rule, published rather than left for a reader to infer.
    expect(description).toContain("arises on unarchive only");
    expect(description).toContain("silent when there is nothing to say");
  });

  /**
   * PR #41. The published exclusion used to be "the document the caller named",
   * whose premise — "that document is the response's own subject, or a `changed`
   * entry in a bulk result" — is false for a bulk row that was refused, was
   * already in the state it asked for, or carried a different verb than the one
   * that moved the folder. It is prose a reader reasons from, so both halves of
   * the corrected rule are pinned: what is left out, and what being *named* does
   * not buy.
   */
  it("excludes only the document whose own archive or unarchive landed, and says so", () => {
    const description = codeSchema()?.description ?? "";
    expect(description).toContain("own archive or unarchive");
    expect(description).toContain("Being named is not enough");
    expect(description).toContain("refused");
    expect(description).toContain("already in the state it asked for");
    expect(description).not.toContain("Neither ever describes the document the caller named");
  });

  it.each([
    [ARCHIVE, "disabled"],
    [UNARCHIVE, "enabled"],
  ])("has %s report every carried document and the enablement it gained or lost", (path, word) => {
    const description = operation(path, "post").description ?? "";
    expect(description).toContain("carried_skill");
    expect(description).toContain(word);
    expect(description).toContain("never named");
    expect(description).toContain("carries no other skill document warns nothing");
  });

  /**
   * Checked in both directions, since the asymmetry is the fact: the archived
   * root reads status from the root itself and never consults the key, so only
   * a move back to the enabled root can reconcile anything. An archive route
   * that advertised a reconciliation would be promising a warning the server
   * can never emit.
   */
  it("advertises the reconciliation on unarchive and, deliberately, nowhere else", () => {
    expect(operation(UNARCHIVE, "post").description).toContain("carried_reconciliation");
    expect(operation(ARCHIVE, "post").description).not.toContain("carried_reconciliation");
  });

  /**
   * PR #37 pinned that the three parts partition the **requested** ids, and a
   * carried document was never requested. The report is *about* the act; making
   * it a fourth part would break the total a caller compares against what it
   * selected.
   */
  it("keeps the carried document out of the result's parts, in both routes' prose", () => {
    for (const path of [ARCHIVE, UNARCHIVE]) {
      expect(operation(path, "post").description, path).toContain(
        "never becomes a changed document",
      );
    }
    expect(resultProperties()).toEqual([
      "changed",
      "alreadyInState",
      "refused",
      "orphanedThreadIds",
      "commit",
      "warnings",
    ]);
    expect(componentSchemas?.["BulkActionResult"]?.properties?.["changed"]?.description).toContain(
      "reported in `warnings`, never as an entry here",
    );
  });

  /**
   * The deliberate omission, pinned from the side that would erase it: the same
   * move stamps the projection's id into a carried file so the move cannot
   * re-mint it, and that write is not warned about — it keeps an identity
   * rather than changing one, and it fires on nearly every carry, which is how
   * the reconciliation beside it would come to be ignored.
   */
  it("says the id stamp is not reported, rather than leaving its absence to be noticed", () => {
    for (const path of [ARCHIVE, UNARCHIVE]) {
      expect(operation(path, "post").description, path).toContain("not reported");
      expect(operation(path, "post").description, path).toContain("identity");
    }
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
      "verbatim",
      "form.respond",
    ]) {
      expect(description, phrase).toContain(phrase);
    }
  });

  /**
   * CONTRACT-038. The field grammar is published on the route for the same
   * reason the fence grammar is: the agent that writes the YAML, the server that
   * validates it and the UI that renders it read it from the document rather
   * than from three private assumptions.
   */
  it("publishes the field grammar, the three kinds and the required default", () => {
    const description = operation(FORM_PATH, "post").description ?? "";
    for (const phrase of [
      "`fields`",
      "`question`",
      "`choose one`",
      "`choose any`",
      "`write`",
      "required unless",
      "`optional: true`",
      "no field ids",
      "one entry per field",
      "all-or-nothing",
    ]) {
      expect(description, phrase).toContain(phrase);
    }
  });

  it("says a rejected answer is a 400 naming the offending entry", () => {
    const op = operation(FORM_PATH, "post");
    expect(op.description).toContain("body.answers");
    expect(op.responses?.["400"]).toBeDefined();
  });

  /**
   * A form is answered once (SPEC.md §6), so a second answer is refused — and
   * with `409` rather than `400`: the body is well formed and the *state* is
   * what refuses it, so retrying with a different body will not help. That is
   * the distinction this repo already draws everywhere else it returns `409`
   * (a taken skill name, a deferral of unclaimed work, a second upgrade).
   */
  it("refuses a second answer with a 409, and says why", () => {
    const op = operation(FORM_PATH, "post");
    expect(op.responses?.["409"]).toBeDefined();
    expect(op.description).toContain("already answered");
    expect(op.description).toContain("ordinary reply");
  });

  /**
   * §6: "Only the person answers a form: the agent never answers a form,
   * including its own." A signal the agent can clear for you is not a signal, so
   * this is a refusal in §9.2's user-only family (deletion, force-unlock), not a
   * silent no-op — and it is `403` for the same reason those are: retrying with
   * a token does not help (SERVER-068).
   */
  it("refuses an agent actor with a 403, and says why", () => {
    const op = operation(FORM_PATH, "post");
    expect(op.responses?.["403"]).toBeDefined();
    expect(op.description).toContain("User-only");
    expect(op.description).toContain("never answers a form");
  });

  it("declares only the codes an answer can produce", () => {
    expect(Object.keys(operation(FORM_PATH, "post").responses ?? {})).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
    ]);
  });

  it("keeps the answer body to the answer", () => {
    expect(Object.keys(componentSchemas?.["FormAnswerRequest"]?.properties ?? {})).toEqual([
      "answers",
      "note",
    ]);
    // `answers` is required but may be empty — a form whose fields are all
    // optional is still unanswered until it is submitted.
    expect(componentSchemas?.["FormAnswerRequest"]?.required).toEqual(["answers"]);
  });

  /**
   * The entry names its field by the question and carries the value under the
   * key that field's kind names. There is no `kind` here and no field id: the
   * form already says what kind the field is, and a second copy could drift.
   */
  it("names a field by its question, with one value key per kind", () => {
    const entry = componentSchemas?.["FormFieldAnswer"];
    expect(Object.keys(entry?.properties ?? {})).toEqual(["question", "option", "options", "text"]);
    expect(entry?.required).toEqual(["question"]);
    expect(entry?.additionalProperties).toBe(false);
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
    expect(description).toContain("{threadId, formTs, answers, note}");
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
      // CONTRACT-021's pair, required and nullable like the origin pair above.
      "blockedOn",
      "blockedOnTitle",
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
    // Derived from the constant rather than retyped: adding a core type
    // (`doc.edited`, CONTRACT-028) must extend what both surfaces publish, and
    // a hand-copied list would have made that a test edit instead of a check.
    expect(description).toContain(CORE_QUEUE_EVENT_TYPES.join(", "));
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

  /**
   * Unchanged by CONTRACT-025 and worth keeping pinned: neither route writes a
   * workspace file, so neither can produce a §14 commit warning. `RebuildResult`
   * carries no warnings field of any kind — a rebuild already reports what it
   * could not use, in `skipped`.
   */
  it("keeps the §14 mutation warning carrier off both db responses", () => {
    expect(componentSchemas?.["RebuildResult"]?.properties?.["warnings"]).toBeUndefined();
    expect(
      JSON.stringify(componentSchemas?.["DoctorReport"]?.properties?.["warnings"]),
    ).not.toContain("#/components/schemas/Warning");
  });

  /**
   * CONTRACT-025. The doctor report's `warnings` is a separate vocabulary for
   * report-only findings (SERVER-038's unindexable files). Pinned from the side
   * that matters: **not** in `required`, because the whole rider is that an
   * A-era client and the shipped handler both stay valid.
   */
  describe("the report-only warnings surface", () => {
    it("hangs report-only findings off the doctor report, not off drift", () => {
      expect(componentSchemas?.["DoctorReport"]?.properties?.["warnings"]).toMatchObject({
        type: "array",
        items: { $ref: "#/components/schemas/DoctorWarning" },
      });
    });

    it("leaves `warnings` out of `required`, which is what makes the rider additive", () => {
      expect(componentSchemas?.["DoctorReport"]?.required).toEqual(["ok", "drift", "stats"]);
    });

    it("appends the field rather than reordering what a reader already knows", () => {
      expect(Object.keys(componentSchemas?.["DoctorReport"]?.properties ?? {})).toEqual([
        "ok",
        "drift",
        "stats",
        "warnings",
      ]);
    });

    /**
     * The asymmetry with `ProjectionDrift.kind` two tests up is the design.
     * A drift kind is the pass/fail vocabulary `ok` is derived from, so it stays
     * closed; a warning kind carries no verdict, so the server can add one
     * without a contract release.
     */
    it("keeps the warning kind an open token, unlike the closed drift enum", () => {
      const kind = componentSchemas?.["DoctorWarning"]?.properties?.["kind"];
      expect(kind?.type).toBe("string");
      expect(kind?.enum).toBeUndefined();
      expect(kind).toMatchObject({ pattern: "^[a-z][a-z0-9_]*$", minLength: 1, maxLength: 64 });
      expect(kind?.description).toContain("Core values: unindexable_file");
      expect(kind?.description).toContain("without a contract release");
    });

    it("names the path, the human detail and the creating commit", () => {
      const warning = componentSchemas?.["DoctorWarning"];
      expect(Object.keys(warning?.properties ?? {})).toEqual(["kind", "path", "detail", "commit"]);
      for (const field of ["kind", "path", "detail", "commit"] as const) {
        expect(warning?.properties?.[field]?.description, field).toBeTruthy();
      }
    });

    /** Nullable, not optional — `ProjectionDrift`'s convention, entry-level. */
    it("keeps every warning key required, with null carrying the absent cases", () => {
      const warning = componentSchemas?.["DoctorWarning"];
      expect(warning?.required).toEqual(["kind", "path", "detail", "commit"]);
      expect(warning?.properties?.["path"]?.type).toEqual(["string", "null"]);
      expect(warning?.properties?.["commit"]).toMatchObject({
        type: ["string", "null"],
        pattern: "^[0-9a-f]{7,64}$",
      });
    });

    /**
     * SERVER-038's TEST-609 requires the human output, the `--json` output and
     * the exit code to agree. The wire's half of that is saying, in the document
     * a client author reads, that a warning is not a verdict.
     */
    it("states in the document that a warning never moves `ok` or the exit code", () => {
      expect(componentSchemas?.["DoctorReport"]?.properties?.["ok"]?.description).toContain(
        "`warnings` never moves it",
      );
      expect(componentSchemas?.["DoctorReport"]?.properties?.["warnings"]?.description).toContain(
        "Never moves `ok` and never changes the exit code",
      );
      expect(operation("/api/db/doctor", "get").description).toContain(
        "arrive separately in `warnings`, which never moves `ok`",
      );
    });

    it("tells a consumer that an absent array and an empty one say the same thing", () => {
      expect(componentSchemas?.["DoctorReport"]?.properties?.["warnings"]?.description).toContain(
        "Absent and empty mean the same thing",
      );
    });
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
      "stale_key",
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
    expect(bodies).toHaveLength(17);
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
      "POST /api/docs/bulk": true,
      "POST /api/docs/{id}/move": true,
      "POST /api/docs/{id}/patch": true,
      "POST /api/jobs/{id}/log": true,
      "POST /api/threads": true,
      "POST /api/threads/{id}/reattach": true,
      "POST /api/queue/{id}/defer": true,
      "POST /api/skills": true,
      "POST /api/queue/halt": false,
      "POST /api/queue/{id}/fail": false,
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

/**
 * CONTRACT-039 — the published half of SHARED-022's transport. Two properties of
 * the document carry the rider's two load-bearing decisions, and both are the
 * kind that a later "tidy-up" undoes without noticing:
 *
 *   - **The levels are never enumerated.** §7 keeps model tiers in the workspace's
 *     own orchestrate skill and §2.4 lets a workspace edit it on its own
 *     schedule, so an `enum` here would reject a workspace's own vocabulary.
 *   - **Absence is not a default.** Stating no weight means the orchestrator
 *     decides, exactly as it does today — so the property is optional, carries no
 *     `default`, and no request body makes it required.
 */
describe("a stated weight rides the request (CONTRACT-039)", () => {
  function deref(node: SchemaNode | undefined): SchemaNode | undefined {
    if (node?.$ref === undefined) return node;
    return componentSchemas?.[node.$ref.split("/").pop() ?? ""];
  }

  /** Every published request body, as `signature → schema`. */
  function requestBodies(): { where: string; schema: SchemaNode | undefined }[] {
    const found: { where: string; schema: SchemaNode | undefined }[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of MUTATING_METHODS) {
        if (!item || !(method in (item as object))) continue;
        for (const [mediaType, mediaObject] of Object.entries(
          operation(path, method).requestBody?.content ?? {},
        )) {
          found.push({
            where: `${method.toUpperCase()} ${path} (${mediaType})`,
            schema: deref((mediaObject as { schema?: SchemaNode }).schema),
          });
        }
      }
    }
    return found;
  }

  /**
   * §11 states the control once for the set of composers rather than per surface
   * (SHARED-012's lesson: per-surface phrasing is how three of five composers
   * shipped without attachments). These are those surfaces on the wire.
   */
  const COMPOSER_BODIES = [
    "POST /api/threads (application/json)",
    "POST /api/threads (multipart/form-data)",
    "POST /api/threads/{id}/turns (application/json)",
    "POST /api/threads/{id}/turns (multipart/form-data)",
    "POST /api/capture (multipart/form-data)",
  ];

  it("offers a weight on every composer's request body", () => {
    const carrying = requestBodies()
      .filter((body) => body.schema?.properties?.weight !== undefined)
      .map((body) => body.where)
      .sort();
    expect(carrying).toEqual([...COMPOSER_BODIES].sort());
  });

  it("publishes it as a plain bounded string, never an enumerated set of levels", () => {
    for (const where of COMPOSER_BODIES) {
      const weight = requestBodies().find((body) => body.where === where)?.schema?.properties
        ?.weight;
      expect(weight?.type, where).toBe("string");
      expect(weight?.enum, where).toBeUndefined();
      expect(weight?.maxLength, where).toBe(REQUESTED_WEIGHT_MAX_LENGTH);
    }
  });

  it("never makes it required and never gives it a default: absence means the orchestrator decides", () => {
    for (const where of COMPOSER_BODIES) {
      const schema = requestBodies().find((body) => body.where === where)?.schema;
      expect(schema?.required ?? [], where).not.toContain("weight");
      expect(Object.hasOwn(schema?.properties?.weight ?? {}, "default"), where).toBe(false);
    }
  });

  it("says what the field is for, so the next reader does not re-derive it", () => {
    const weight = requestBodies().find((body) => body.where === COMPOSER_BODIES[0])?.schema
      ?.properties?.weight;
    for (const phrase of [
      "directive, not a hint",
      "never enumerates the levels",
      "never silently substituted in either direction",
      "cannot be honoured",
      "the orchestrator decides",
    ]) {
      expect(weight?.description, phrase).toContain(phrase);
    }
  });

  /** The other end of the ride: the dispatch reads it off the queue event. */
  it("documents the payload key the event carries it under", () => {
    const payload = componentSchemas?.["QueueEvent"]?.properties?.payload;
    expect(payload?.description).toContain("`weight`");
    expect(payload?.description).toContain("the orchestrator decides");
  });
});
