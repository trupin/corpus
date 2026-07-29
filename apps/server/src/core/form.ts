// Reading the ```` ```form ```` fence a turn body may carry (SPEC.md §6).
//
// **One reader, because three surfaces have to answer identically about the
// same bytes.** `POST …/turns/{ts}/form` decides whether an answer is
// acceptable; the projection's `needs=form` decides whether Attention says
// "awaiting your answer"; the UI decides whether to draw the controls. Before
// SERVER-029 the first two disagreed in three ways at once — the projection
// matched the fence with a SQL substring search while the route matched it with
// the contract's regex — and every disagreement was a stuck row:
//
//   - an **unterminated** fence: listed by `needs=form`, `404` from the route;
//   - a **trailing-space info string** (`` ```form␠␠ ``): answerable by the
//     route, never listed, so nobody was ever told to answer it;
//   - a fence whose **YAML is not a form**: listed, `404` from the route.
//
// Their common cause was having two definitions of "carries a form", so the fix
// is to have one. The grammar itself stays the contract's — `extractFormSource`
// / `findFormFence` for the fence, `FormSchema` for the fields — because
// the UI depends on it too and cannot import this module (CONTRACT-013). What
// lives here is only the *composition* of the contract's parser with a YAML
// parse, which the contract cannot do (it carries no YAML dependency).
//
// The projection consumes this through a `turns.has_form` column rather than
// through SQL of its own: SQLite can express neither the fence scan nor the
// YAML, and a second translation of the grammar is exactly what went wrong.
// CONTRACT-014 settled the grammar (a CommonMark subset — the settlement and
// its three restrictions are documented in the contract's `schemas/form.ts`);
// the change reached every consumer here with no code change beyond the
// `SCHEMA_VERSION` bump that recomputed `has_form` under the settled rules.

import type { Form } from "@corpus/contract";
import { FormSchema, extractFormSource } from "@corpus/contract";
import * as YAML from "yaml";

/**
 * Why a turn body does not carry a form. Kept as distinct reasons because the
 * answer route reports each with its own message: the caller needs to know it
 * cannot answer, and whoever reads the log needs to know why.
 */
export type NoFormReason =
  /** No opening fence whose info string is exactly `form` (```` ```formula ```` is not one). */
  | "no-fence"
  /** A fence, whose contents are not YAML. */
  | "not-yaml"
  /** Valid YAML that is not a prompt plus options. */
  | "not-a-form";

export type FormReading =
  | { readonly ok: true; readonly form: Form }
  | { readonly ok: false; readonly reason: NoFormReason; readonly detail: string | null };

/**
 * The form a turn body carries, or why it carries none.
 *
 * A malformed fence is never an exception: the bytes came off a file a person or
 * an agent wrote, so bad YAML there is an ordinary state of the world — the
 * route degrades it to a `404`, the UI to a code block with a warning, and the
 * projection to "not awaiting an answer".
 */
export function readForm(body: string): FormReading {
  const source = extractFormSource(body);
  if (source === undefined) return { ok: false, reason: "no-fence", detail: null };

  let value: unknown;
  try {
    value = YAML.parse(source) ?? undefined;
  } catch (error) {
    return {
      ok: false,
      reason: "not-yaml",
      detail: error instanceof Error ? error.message : null,
    };
  }

  const parsed = FormSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "not-a-form",
      detail: parsed.error.issues[0]?.message ?? null,
    };
  }
  return { ok: true, form: parsed.data };
}

/**
 * Whether a turn body carries a form that can actually be answered — the fact
 * the projection stores per turn, and the condition `needs=form` is built on.
 *
 * "Answerable" and not merely "fenced": §11's reason exists to tell the user
 * there is an action waiting, and a fence the answer route refuses is an action
 * nobody can take. Note this says nothing about *who wrote* the turn — §6 makes
 * a form something an agent turn carries, and that half of the condition is the
 * projection's `author` column, so a user turn quoting a fence is excluded there
 * exactly as it is excluded by the route's own author check.
 */
export const carriesForm = (body: string): boolean => readForm(body).ok;
