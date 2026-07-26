// `@corpus/contract` — the single source of truth for the Corpus HTTP API
// (SPEC.md §9.3). Zod schemas define every resource; `createRoute` definitions
// declare every endpoint; `openapi.json` and the typed client under
// `@corpus/contract/client` are generated from them.
//
// The client entry point is deliberately a separate subpath so browser bundles
// pull in the client without the route definitions and their Hono dependency.

export * from "./actor.js";
export * from "./openapi.js";
export * from "./routes/index.js";
export * from "./schemas/index.js";
