import { DocumentIdSchema, MAX_REPORT_SUBJECTS } from "@corpus/contract";
import type { ParsedArgs, ParsedFlags } from "../parse-args.js";
import type { CommandSpec, FlagSpec } from "../registry/types.js";

/**
 * Which documents and threads an invocation **named** (SPEC.md §9.4, CLI-085).
 *
 * ## Driven by the registry, not by the argv
 *
 * The values are selected by the `subject` marker each argument and flag
 * declares about itself (`ArgSpec.subject`, `FlagSpec.subject`), never by
 * scanning the command line for anything that looks like an id. Two properties
 * follow, and both are
 * the reason for the marker:
 *
 * - **A verb's attribution is a property of its declaration.** `corpus doc show
 *   <id>…` names its documents in a positional and `corpus thread create
 *   --parent <doc-id>` names one in a flag, and one word on each declaration
 *   covers both. A scan would have to keep a second model of the surface.
 * - **An id that is not a document stays out.** `--job evt_7c1d`, `corpus job
 *   log <event-id>`, `--from-rev <sha>` and `--key` are all id-shaped values
 *   that name no document, and a scan would attribute a document's cost to them
 *   or theirs to a document.
 *
 * Ids read back out of a **response** are never subjects, which is why
 * `corpus search` and bare `corpus doc list` report none: attributing a
 * listing's cost to the documents it returned would measure a different thing
 * from the one §9.4 defines.
 *
 * ## What the extractor does to a marked value, and why
 *
 * **A comma-separated value contributes each of its ids.** `--columns
 * doc_a,doc_b` is one flag naming two board columns, and an id contains no
 * comma (`^(doc|th)_[A-Za-z0-9]+$`), so splitting can only ever separate ids
 * that were listed together.
 *
 * **A value that is not an id shape is dropped.** The wire refuses a malformed
 * subject with a `400`, and a refused report is lost whole — so one mistyped id
 * on the command line would silently cost the invocation its entire
 * measurement. Dropping the value keeps the rest. This is a guard on the way
 * out, not the selection rule: which values are *considered* is still the
 * registry's declaration alone.
 *
 * **Duplicates collapse, and the list is capped.** One invocation naming the
 * same document twice paid for it once. Past {@link MAX_REPORT_SUBJECTS} the
 * wire refuses the report, so the extra ids are dropped rather than allowed to
 * lose the whole measurement — a verb reaching that many documents is
 * `corpus doc check doc_… ×65`, and the alternative is no record of it at all.
 */
export function collectSubjects(
  command: Pick<CommandSpec, "args" | "flags">,
  args: ParsedArgs,
  flags: ParsedFlags,
): readonly string[] {
  const found: string[] = [];

  for (const arg of command.args) {
    if (arg.subject !== true) continue;
    found.push(...args.list(arg.name));
  }
  for (const flag of command.flags) {
    if (flag.subject !== true) continue;
    found.push(...flagValues(flag, flags));
  }

  const ids = new Set<string>();
  for (const value of found) {
    for (const candidate of value.split(",")) {
      const id = candidate.trim();
      if (id !== "" && DocumentIdSchema.safeParse(id).success) ids.add(id);
    }
  }
  return [...ids].slice(0, MAX_REPORT_SUBJECTS);
}

function flagValues(flag: FlagSpec, flags: ParsedFlags): readonly string[] {
  if (flag.repeated === true) return flags.strings(flag.name);
  const value = flags.string(flag.name);
  return value === undefined ? [] : [value];
}
