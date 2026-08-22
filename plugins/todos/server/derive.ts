import { deriveStatus, type DerivedTodoStatus } from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";

/**
 * The derived-status extension point's non-UI half (PLUGINS-016; SPEC.md §12,
 * rider signed 2026-08-12) — what the server executes for a plugin whose
 * `types.yaml` declares a type with `derivedStatus: true`.
 *
 * **Discovery convention** (the seam SERVER-085 consumes): the module lives at
 * `plugins/<dir>/server/derive.ts` (compiled: `dist/server/derive.js`) and
 * default-exports one function over every derived type the plugin declares —
 * the same default-export convention `manifest.ts` and `server/routes.ts`
 * already follow, imported the same way and under the same containment: a
 * module that fails to load, exports no function, or throws is a logged
 * warning and a skipped derivation, never a boot or write failure — the
 * stored value stands.
 *
 * **A type this plugin does not own never derives here.** The server calls
 * this only for documents whose type this plugin's own `types.yaml` flags
 * `derivedStatus: true`, so a foreign type cannot reach it by construction —
 * and the function guards anyway, answering `null` (stored value stands), so
 * a mis-wired caller degrades instead of mislabeling someone else's document.
 *
 * The derivation itself lives in `../items.ts` beside every other reading of
 * an item, and is byte-for-byte the one the manifest's `deriveStatus` wraps —
 * `parity.test.ts` pins that the two can never drift. Structural input rather
 * than the contract's `Doc`, for the same reason `PluginRoutesFactory` stays
 * duck-typed in `apps/server`: this module is dynamically imported and proves
 * nothing, so the server validates the answer, not the signature.
 */
export interface DeriveStatusInput {
  /** The document's frontmatter `type`. */
  readonly type: string;
  /** The stored frontmatter `status` — `archived` always stands (SPEC.md §5, §12). */
  readonly status: string;
  /** The raw markdown body. */
  readonly body: string;
  /** The document's `extra` frontmatter — where a legacy `items` key would live. */
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

function derive(input: DeriveStatusInput): DerivedTodoStatus | null {
  if (input.type !== TODO_DOC_TYPE) return null;
  return deriveStatus({ body: input.body, extra: input.extra }, input.status);
}

// Default export because discovery requires one, exactly as it does of
// `manifest.ts` and `server/routes.ts` (docs/TS_GUIDELINES.md — Naming).
export default derive;
