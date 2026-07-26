// Placeholder entry point — the real `corpus` command surface arrives with CLI-001.
export const PACKAGE_NAME = "@corpus/cli";

/**
 * Stub command surface. Exists so the published `corpus` bin is a real,
 * runnable entry point before CLI-001 fills in the commands; returning the
 * string (rather than writing it) keeps the logic testable and the bin thin.
 */
export function runCli(): string {
  return "corpus: no commands yet — the command surface arrives with CLI-001.";
}
