// A doc type whose **core fields are derived from the document itself** (SPEC.md
// §12: the `status` rider signed 2026-08-12, and `due` per PLUGINS-018 —
// PLUGINS-016 landed the seam, SERVER-085 made `status` the answer everywhere,
// SERVER-134 added `due` as its second member).
//
// The registry is the server's whole view of that extension point: which types
// declare each derived field, and the function to ask. Everything that reports
// one of those fields goes through a {@link DerivedFieldRegistry.derive} and
// composes the one rule the seam's author drew — the derivation first, the
// stored value when it declines — because the derivation itself owns both of
// §12's carve-outs (an archived document and a document whose items cannot be
// read both decline, and the stored value stands). Re-implementing either guard
// at a call site would be the same rule in two places, which is exactly the
// shape PR #48 flagged as CRITICAL.
//
// **One registry, one member per field, never a second mechanism.** Everything
// two fields share — ownership, the first-plugin-wins rule, containment of a
// throw or a nonsense answer, warn-once — is written once here and parameterised
// over the field. What genuinely differs is the *validator*, and it is the only
// thing a third field would have to bring: `status` chooses between two strings,
// `due` answers an object whose one key is an ISO calendar date or `null`.

import type { DocStatus } from "@corpus/contract";
import { normalizeCalendarDate } from "../core/time.js";
import { describeThrown } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";

/**
 * What a `status` derivation may answer. Never `archived`: archiving says where
 * a document is kept (§5), which no reading of its content can imply, so the
 * derivation chooses between `open` and `resolved` and nothing else.
 */
export type DerivedDocStatus = Exclude<DocStatus, "archived">;

/**
 * What a `due` derivation may answer — a wrapper rather than a bare `string |
 * null`, because a deadline has **three** answers where a status has two:
 *
 * - `{ due: "YYYY-MM-DD" }` — this is the document's deadline.
 * - `{ due: null }` — the derivation applies and there is **no** deadline. The
 *   field must end up empty: SQL NULL in the row and core's own empty spelling
 *   in the file.
 * - `null` (the outer value, never this object) — the derivation does not apply
 *   and whatever the document stores stands.
 *
 * The middle answer is the one a bare `string | null` cannot say, and it is the
 * one that has to clear the field when the last dated item is checked
 * (PLUGINS-018 decision 2). No caller may collapse it into either neighbour.
 */
export interface DerivedDocDue {
  /** An ISO calendar date (`YYYY-MM-DD`), or `null` for "no deadline". */
  readonly due: string | null;
}

const DERIVABLE_STATUS: readonly string[] = ["open", "resolved"];

/** The document a derivation is asked about — the seam's structural input. */
export interface DeriveInput {
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
 * One export of a plugin's `server/derive` module, as imported. The answer is
 * typed `unknown` on purpose: the module was dynamically imported and proves
 * nothing, exactly like `PluginRoutesFactory`, so the server validates the
 * **answer** rather than the signature.
 */
export type PluginDerive = (input: DeriveInput) => unknown;

/** One derived core field, as the rest of the server asks about it. */
export interface DerivedFieldRegistry<T> {
  /** The declared types, for callers that must decide before parsing anything. */
  readonly types: ReadonlySet<string>;
  /** Whether any plugin declares this type's field derived. */
  derives(type: string | null | undefined): boolean;
  /**
   * The derived value, or `null` when the **stored** value stands — because no
   * plugin owns this type, because the derivation says so (§12's two carve-outs),
   * or because the module misbehaved. Never throws.
   */
  derive(input: DeriveInput): T | null;
}

/** Every derived field, one member each. */
export interface DerivedFieldsRegistry {
  readonly status: DerivedFieldRegistry<DerivedDocStatus>;
  readonly due: DerivedFieldRegistry<DerivedDocDue>;
  /**
   * Every type that derives **any** field — the union, so a path that only needs
   * to know whether a document is worth parsing asks one question instead of one
   * per field. The busiest write in the system (a turn append) is dismissed on
   * this alone.
   */
  readonly types: ReadonlySet<string>;
  derives(type: string | null | undefined): boolean;
}

const emptyField = <T>(): DerivedFieldRegistry<T> => ({
  types: new Set<string>(),
  derives: () => false,
  derive: () => null,
});

/** No plugin declares anything — every document keeps the fields its file states. */
export const EMPTY_DERIVED_FIELDS: DerivedFieldsRegistry = {
  status: emptyField<DerivedDocStatus>(),
  due: emptyField<DerivedDocDue>(),
  types: new Set<string>(),
  derives: () => false,
};

/**
 * What {@link createDerivedFieldsRegistry} needs of a discovered plugin —
 * structural, so `DiscoveredPlugin` satisfies it without this module importing
 * discovery (which imports this one).
 */
export interface DerivedFieldsDeclaration {
  /** The plugin's directory name — its identity in a warning. */
  readonly dir: string;
  /** Its `types.yaml` entries; the flagged ones are the derived types, per field. */
  readonly types: readonly {
    readonly type: string;
    readonly derivedStatus?: true | undefined;
    readonly derivedDue?: true | undefined;
  }[];
  /** Its `server/derive` **default** export (`status`), or `null` when it ships none. */
  readonly deriveStatus: PluginDerive | null;
  /** Its `server/derive` named `deriveDue` export, or `null` when it ships none. */
  readonly deriveDue: PluginDerive | null;
}

/**
 * How one field differs from the others, which is all a fourth field would have
 * to bring: what its `types.yaml` flag is called, which export answers it, how
 * an answer is validated, and how to say "that is not one" to an operator.
 */
interface FieldSpec<T> {
  /** The core field's name — the word in every warning this field produces. */
  readonly field: string;
  /** Its `types.yaml` flag. */
  readonly flag: "derivedStatus" | "derivedDue";
  /** Its export on the plugin's `server/derive` module. */
  readonly exported: (declaration: DerivedFieldsDeclaration) => PluginDerive | null;
  /** The answer, or `null` when the module answered something this field cannot be. */
  readonly validate: (answer: unknown) => T | null;
  /** What the operator is told the acceptable answers are. */
  readonly expected: string;
}

const STATUS_FIELD: FieldSpec<DerivedDocStatus> = {
  field: "status",
  flag: "derivedStatus",
  exported: (declaration) => declaration.deriveStatus,
  validate: (answer) =>
    typeof answer === "string" && DERIVABLE_STATUS.includes(answer)
      ? (answer as DerivedDocStatus)
      : null,
  expected: "open, resolved or null",
};

const DUE_FIELD: FieldSpec<DerivedDocDue> = {
  field: "due",
  flag: "derivedDue",
  exported: (declaration) => declaration.deriveDue,
  // An object with one key, and the two spellings of its value are **not**
  // interchangeable: `{ due: null }` says this document has no deadline, which
  // is a different answer from the outer `null` the caller has already handled.
  // A date is normalized here — through the same reader the projection's own
  // column goes through — so a plugin answering `2026-8-4` or a padded string is
  // either one canonical date or contained as nonsense, never written raw into a
  // document's frontmatter.
  validate: (answer) => {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
    if (!("due" in answer)) return null;
    const due: unknown = answer.due;
    if (due === null) return { due: null };
    if (typeof due !== "string") return null;
    const normalized = normalizeCalendarDate(due);
    return normalized === null ? null : { due: normalized };
  },
  expected: "an object carrying an ISO calendar date or null",
};

/**
 * Builds the registry from what discovery found.
 *
 * **A type derives a field only when its own plugin declares it and ships the
 * export.** The declaration and the executable are two halves of one seam
 * (PLUGINS-016), so a `types.yaml` flag whose plugin loaded no matching export
 * leaves that type on its stored value — discovery has already said why — and no
 * plugin's derivation is ever asked about a type it does not claim.
 *
 * **The first plugin to claim a type keeps it**, per field. Directories are
 * discovered in sorted order, so the winner is the same on every machine, and
 * the loser is logged rather than silently ignored: two plugins deriving one
 * type would make a document's fields depend on discovery order, which is not a
 * thing an operator can debug.
 */
export function createDerivedFieldsRegistry(
  declarations: readonly DerivedFieldsDeclaration[],
  logger: Logger = silentLogger,
): DerivedFieldsRegistry {
  // One line per plugin per field per fault, not one per document: a derivation
  // that throws is asked once per file, and a rebuild of a real workspace would
  // otherwise write the same warning eight hundred times. Shared across fields
  // so the *set* is one, keyed so a broken `due` is still reported after a
  // broken `status` on the same plugin and type.
  const reported = new Set<string>();
  const warnOnce = (key: string, message: string, context: Record<string, unknown>): void => {
    if (reported.has(key)) return;
    reported.add(key);
    logger.info(`warning: ${message}`, context);
  };

  const build = <T>(spec: FieldSpec<T>): DerivedFieldRegistry<T> => {
    const byType = new Map<string, { plugin: string; derive: PluginDerive }>();

    for (const declaration of declarations) {
      const declared = declaration.types
        .filter((entry) => entry[spec.flag] === true)
        .map((entry) => entry.type);
      if (declared.length === 0) continue;
      const derive = spec.exported(declaration);
      if (derive === null) {
        // Discovery has already warned about the missing module or export; this
        // is only the consequence, and it must not be a second line in the boot
        // log.
        continue;
      }
      for (const type of declared) {
        const held = byType.get(type);
        if (held !== undefined) {
          logger.info(
            `warning: plugin ${declaration.dir} — doc type ${type} already derives its ` +
              `${spec.field} through plugin ${held.plugin}; this declaration is ignored`,
            { plugin: declaration.dir, type, field: spec.field },
          );
          continue;
        }
        byType.set(type, { plugin: declaration.dir, derive });
      }
    }

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
            `${owner.plugin}:${input.type}:${spec.field}:threw`,
            `plugin ${owner.plugin} — its ${spec.field} derivation for ${input.type} threw; ` +
              "those documents keep the value their files state (further occurrences are not " +
              "logged)",
            { plugin: owner.plugin, type: input.type, field: spec.field, ...describeThrown(error) },
          );
          return null;
        }

        if (answer === null || answer === undefined) return null;
        const validated = spec.validate(answer);
        if (validated !== null) return validated;
        // An out-of-range answer is the same class of event as a throw: the
        // module proves nothing, so `archived`, a number, a typo or a date that
        // is not one is contained here rather than written into a document's
        // frontmatter and a projection row.
        warnOnce(
          `${owner.plugin}:${input.type}:${spec.field}:out-of-range`,
          `plugin ${owner.plugin} — its ${spec.field} derivation for ${input.type} answered ` +
            `${JSON.stringify(answer) ?? typeof answer}, which is not ${spec.expected}; ` +
            "those documents keep the value their files state (further occurrences are not logged)",
          { plugin: owner.plugin, type: input.type, field: spec.field },
        );
        return null;
      },
    };
  };

  const status = build(STATUS_FIELD);
  const due = build(DUE_FIELD);
  const types = new Set([...status.types, ...due.types]);

  return {
    status,
    due,
    types,
    derives(type) {
      return type !== null && type !== undefined && types.has(type);
    },
  };
}
