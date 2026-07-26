import type { FlagSpec } from "./types.js";

/**
 * Declared once and merged into every command by the parser, the help renderer
 * and the docs generator. Registry validation rejects a topic flag that shadows
 * one of these names or aliases, so the merge can never be ambiguous.
 */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  {
    name: "json",
    type: "boolean",
    description:
      'Write exactly one machine-readable JSON value to stdout, and failures as `{"error":{…}}` to stderr.',
  },
  {
    name: "workspace",
    type: "string",
    valueName: "path",
    description:
      "Workspace to act on, instead of searching upward from the current directory. Overrides CORPUS_WORKSPACE.",
  },
  {
    name: "timeout",
    type: "number",
    valueName: "ms",
    default: 10000,
    description:
      "How long to wait for the workspace server before reporting it unreachable (exit 4).",
  },
  {
    name: "verbose",
    type: "boolean",
    description: "Include the stack trace when an unexpected internal error occurs.",
  },
  {
    name: "no-color",
    type: "boolean",
    description: "Never emit ANSI colour. Implied whenever stdout is not a TTY.",
  },
  {
    name: "help",
    alias: "h",
    type: "boolean",
    description: "Show help for the current topic or command and exit.",
  },
  {
    name: "version",
    type: "boolean",
    description: "Print the version of the `corpus` tool and exit.",
  },
];

export const GLOBAL_FLAG_NAMES: ReadonlySet<string> = new Set(
  GLOBAL_FLAGS.map((flag) => flag.name),
);

export const GLOBAL_FLAG_ALIASES: ReadonlySet<string> = new Set(
  GLOBAL_FLAGS.flatMap((flag) => (flag.alias === undefined ? [] : [flag.alias])),
);
