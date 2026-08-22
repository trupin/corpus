import {
  deriveDue as deriveDueFromItems,
  deriveStatus as deriveStatusFromItems,
  type DerivedTodoDue,
  type DerivedTodoStatus,
} from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";

/**
 * The derived-field extension point's non-UI half (PLUGINS-016 for `status`,
 * PLUGINS-018 for `due`; SPEC.md §12) — what the server executes for a plugin
 * whose `types.yaml` declares a type with `derived<Field>: true`.
 *
 * **Discovery convention** (the seam SERVER-085 consumes): the module lives at
 * `plugins/<dir>/server/derive.ts` (compiled: `dist/server/derive.js`) and
 * carries **one export per derived field** — the default export for `status`,
 * which is the field the seam shipped with, and a named export for every field
 * after it. One module for all of them, deliberately: a plugin's server half is
 * one directory with one build, and a second discovery rule for a second field
 * would be a second thing to get wrong (and a second thing to forget in
 * `scripts/package-staging.ts`, where `server/derive.js` is already a staged
 * entry point — extending this file inherits that and adding a sibling module
 * would not).
 *
 * Every export follows the same convention `manifest.ts` and `server/routes.ts`
 * already follow, imported the same way and under the same containment: a
 * module that fails to load, exports no function, or throws is a logged warning
 * and a skipped derivation, never a boot or write failure — the stored value
 * stands.
 *
 * **A type this plugin does not own never derives here.** The server calls
 * these only for documents whose type this plugin's own `types.yaml` flags, so
 * a foreign type cannot reach them by construction — and every function guards
 * anyway, answering `null` (stored value stands), so a mis-wired caller
 * degrades instead of mislabeling someone else's document.
 *
 * The derivations themselves live in `../items.ts` beside every other reading
 * of an item, and are byte-for-byte the ones the manifest's `deriveStatus` and
 * `deriveDue` wrap — `parity.test.ts` pins that the pairs can never drift.
 * Structural input rather than the contract's `Doc`, for the same reason
 * `PluginRoutesFactory` stays duck-typed in `apps/server`: this module is
 * dynamically imported and proves nothing, so the server validates the answer,
 * not the signature.
 */
export interface DeriveInput {
  /** The document's frontmatter `type`. */
  readonly type: string;
  /**
   * The stored frontmatter `status`. Read by **every** derivation, whatever
   * field it answers for, because `archived` is the seam's shared
   * not-applicable state: a document put away makes no claim about what is
   * left to do (SPEC.md §5, §12).
   */
  readonly status: string;
  /** The raw markdown body. */
  readonly body: string;
  /** The document's `extra` frontmatter — where a legacy `items` key would live. */
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * `status` — the seam's first field, and therefore the default export.
 * `resolved` for a list holding at least one item and no open ones, `open` for
 * every other readable list, `null` when the derivation does not apply.
 */
function deriveStatus(input: DeriveInput): DerivedTodoStatus | null {
  if (input.type !== TODO_DOC_TYPE) return null;
  return deriveStatusFromItems({ body: input.body, extra: input.extra }, input.status);
}

/**
 * `due` — the earliest **open** item's deadline, as the document's own.
 *
 * Three answers, and no caller may collapse two of them: `{ due: <date> }` is
 * the deadline, `{ due: null }` says this list has none and the field must be
 * *absent* from the document rather than present-and-empty, and `null` says the
 * derivation does not apply and the stored value stands.
 */
function deriveDue(input: DeriveInput): DerivedTodoDue | null {
  if (input.type !== TODO_DOC_TYPE) return null;
  return deriveDueFromItems({ body: input.body, extra: input.extra }, input.status);
}

export { deriveDue, deriveStatus };
export default deriveStatus;
