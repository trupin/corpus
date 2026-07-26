/**
 * `@corpus/kit` — the only import surface plugins may use (SPEC.md §10).
 *
 * The JavaScript surface (query hooks, markdown/thread views, doc rows, the
 * composer, layout primitives) arrives with the later kit issues. What already
 * ships is the design-token layer, exported as a stylesheet subpath rather than
 * from this module because CSS has no compile step:
 *
 *     import "@corpus/kit/tokens.css";
 *
 * Importing it is how a plugin — or `apps/ui` itself — inherits Corpus theming,
 * including the light/dark contract described in `src/tokens.css`.
 */
export const PACKAGE_NAME = "@corpus/kit";
