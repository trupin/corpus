// `@corpus/contract` — the single source of truth for the Corpus HTTP API
// (SPEC.md §9.3). Zod schemas define every resource; `createRoute` definitions
// declare every endpoint; `openapi.json` and the typed client under
// `@corpus/contract/client` are generated from them.
//
// The client entry point is deliberately a separate subpath so browser bundles
// pull in the client without the route definitions and their Hono dependency.

// `code.js` and `turns.js` are not API shapes: they are the rules of the
// **on-disk** format that more than one side has to read the same way — which
// bytes are code, and which lines delimit a turn (SPEC.md §5, §6). They live
// here for the reason `schemas/form.ts`'s fence grammar does: the server refuses
// or reports a body that breaks them and the composer wants to say so before the
// round trip, `apps/ui` cannot import `apps/server`, and a second scanner is a
// scanner that drifts (CONTRACT-044).

export * from "./actor.js";
export * from "./code.js";
export * from "./openapi.js";
export * from "./query-keys.js";
export * from "./routes/index.js";
export * from "./schemas/index.js";
export * from "./scope.js";
export * from "./turns.js";
