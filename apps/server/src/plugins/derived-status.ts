// A doc type whose `status` is **derived from the document itself** (SPEC.md
// §12, rider signed 2026-08-12; PLUGINS-016 landed the seam, SERVER-085 made it
// the answer).
//
// The registry is the server's whole view of that extension point: which types
// declare a derived status, and the function to ask. Everything that reports a
// status goes through {@link DerivedStatusRegistry.derive} and composes the one
// rule the seam's author drew — `derive(...) ?? stored` — because the derivation
// itself owns both of §12's carve-outs (an archived document and a document
// whose items cannot be read both answer `null`, and the stored value stands).
// Re-implementing either guard at a call site would be the same rule in two
// places, which is exactly the shape PR #48 flagged as CRITICAL.

import type { DocStatus } from "@corpus/contract";
import { describeThrown } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";

/**
 * What a derivation may answer. Never `archived`: archiving says where a
 * document is kept (§5), which no reading of its content can imply, so the
 * derivation chooses between `open` and `resolved` and nothing else.
 */
export type DerivedDocStatus = Exclude<DocStatus, "archived">;

const DERIVABLE: readonly string[] = ["open", "resolved"];

/** The document a derivation is asked about — the seam's structural input. */
export interface DeriveStatusInput {
  /** The document's `type`, as the projection resolves it. */
  readonly type: string;
  /** The **stored** frontmatter status; `archived` is the derivation's own guard. */
  readonly status: string;
  /** The raw markdown body. */
  readonly body: string;
  /** Non-reserved frontmatter keys — where a plugin's legacy state would live. */
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A plugin's `server/derive` module, as imported. The answer is typed `unknown`
 * on purpose: the module was dynamically imported and proves nothing, exactly
 * like `PluginRoutesFactory`, so the server validates the **answer** rather than
 * the signature.
 */
export type PluginDeriveStatus = (input: DeriveStatusInput) => unknown;

export interface DerivedStatusRegistry {
  /** The declared types, for callers that must decide before parsing anything. */
  readonly types: ReadonlySet<string>;
  /** Whether any plugin declares this type's status derived. */
  derives(type: string | null | undefined): boolean;
  /**
   * The derived status, or `null` when the **stored** value stands — because no
   * plugin owns this type, because the derivation says so (§12's two carve-outs),
   * or because the module misbehaved. Never throws.
   */
  derive(input: DeriveStatusInput): DerivedDocStatus | null;
}

/** No plugin declares anything — every document keeps the status its file states. */
export const EMPTY_DERIVED_STATUS: DerivedStatusRegistry = {
  types: new Set<string>(),
  derives: () => false,
  derive: () => null,
};

/**
 * What {@link createDerivedStatusRegistry} needs of a discovered plugin —
 * structural, so `DiscoveredPlugin` satisfies it without this module importing
 * discovery (which imports this one).
 */
export interface DerivedStatusDeclaration {
  /** The plugin's directory name — its identity in a warning. */
  readonly dir: string;
  /** Its `types.yaml` entries; the flagged ones are the derived types. */
  readonly types: readonly { readonly type: string; readonly derivedStatus?: true | undefined }[];
  /** Its `server/derive` default export, or `null` when it ships none. */
  readonly deriveStatus: PluginDeriveStatus | null;
}

/**
 * Builds the registry from what discovery found.
 *
 * **A type is derived only when its own plugin declares it and ships the
 * module.** The declaration and the executable are two halves of one seam
 * (PLUGINS-016), so a `types.yaml` flag whose plugin loaded no `server/derive`
 * module leaves that type on its stored status — discovery has already said why
 * — and no plugin's derivation is ever asked about a type it does not claim.
 *
 * **The first plugin to claim a type keeps it.** Directories are discovered in
 * sorted order, so the winner is the same on every machine, and the loser is
 * logged rather than silently ignored: two plugins deriving one type would make
 * a document's status depend on discovery order, which is not a thing an
 * operator can debug.
 */
export function createDerivedStatusRegistry(
  declarations: readonly DerivedStatusDeclaration[],
  logger: Logger = silentLogger,
): DerivedStatusRegistry {
  const byType = new Map<string, { plugin: string; derive: PluginDeriveStatus }>();

  for (const declaration of declarations) {
    const declared = declaration.types
      .filter((entry) => entry.derivedStatus === true)
      .map((entry) => entry.type);
    if (declared.length === 0) continue;
    const derive = declaration.deriveStatus;
    if (derive === null) {
      // Discovery has already warned about the missing module; this is only the
      // consequence, and it must not be a second line in the boot log.
      continue;
    }
    for (const type of declared) {
      const held = byType.get(type);
      if (held !== undefined) {
        logger.info(
          `warning: plugin ${declaration.dir} — doc type ${type} already derives its status ` +
            `through plugin ${held.plugin}; this declaration is ignored`,
          { plugin: declaration.dir, type },
        );
        continue;
      }
      byType.set(type, { plugin: declaration.dir, derive });
    }
  }

  // One line per plugin per fault, not one per document: a derivation that
  // throws is asked once per file, and a rebuild of a real workspace would
  // otherwise write the same warning eight hundred times.
  const reported = new Set<string>();
  const warnOnce = (key: string, message: string, context: Record<string, unknown>): void => {
    if (reported.has(key)) return;
    reported.add(key);
    logger.info(`warning: ${message}`, context);
  };

  return {
    types: new Set(byType.keys()),
    derives(type) {
      return type !== null && type !== undefined && byType.has(type);
    },
    derive(input) {
      const owner = byType.get(input.type);
      if (owner === undefined) return null;

      let answer: unknown;
      try {
        answer = owner.derive(input);
      } catch (error) {
        warnOnce(
          `${owner.plugin}:${input.type}:threw`,
          `plugin ${owner.plugin} — its status derivation for ${input.type} threw; those ` +
            "documents keep the status their files state (further occurrences are not logged)",
          { plugin: owner.plugin, type: input.type, ...describeThrown(error) },
        );
        return null;
      }

      if (answer === null || answer === undefined) return null;
      if (typeof answer === "string" && DERIVABLE.includes(answer)) {
        return answer as DerivedDocStatus;
      }
      // An out-of-range answer is the same class of event as a throw: the module
      // proves nothing, so `archived`, a number or a typo is contained here
      // rather than written into a document's frontmatter and a projection row.
      warnOnce(
        `${owner.plugin}:${input.type}:out-of-range`,
        `plugin ${owner.plugin} — its status derivation for ${input.type} answered ` +
          `${JSON.stringify(answer) ?? typeof answer}, which is not open, resolved or null; ` +
          "those documents keep the status their files state (further occurrences are not logged)",
        { plugin: owner.plugin, type: input.type },
      );
      return null;
    },
  };
}
