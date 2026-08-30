import { FROM_FLAG } from "../input.js";
import type { FlagSpec } from "./types.js";

/**
 * Declared once and merged into every command by the parser, the help renderer
 * and the docs generator. Registry validation rejects a topic flag that shadows
 * one of these names or aliases, so the merge can never be ambiguous.
 */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  FROM_FLAG,
  {
    name: "json",
    type: "boolean",
    description:
      'Write exactly one machine-readable JSON value to stdout, and failures as `{"error":{…}}` to stderr. ' +
      "The error carries `code`, `message` and `hint` — the recovery, in the same words a person is shown — " +
      "plus `details` and `changed` where they apply. `hint` is always present and is `null` when there is " +
      "no follow-up beyond the message, so absence never has to be guessed at.",
  },
  {
    // Spelled literally, not imported: `parse-args.ts` imports this module, so
    // taking its constant here would be a cycle evaluated at module level.
    // `globals.test.ts` asserts the two agree.
    name: "flag-file",
    type: "string",
    repeated: true,
    valueName: "flag=path",
    description:
      "Take a flag's value from a file, byte for byte: `--flag-file title=/tmp/title.txt`. " +
      "Repeatable, and it works for any flag on any command that takes text. " +
      "**Use it for words somebody else wrote.** A value passed this way never goes through a " +
      "shell, so nothing in it can be expanded, quoted or run — including a line that happens to " +
      "read like the end of a heredoc, which is how a pasted terminal transcript once executed " +
      "its own commands and put their output in a document as though a person had written it " +
      "(CLI-051). Giving both the flag and its `--flag-file` is refused rather than one silently " +
      "winning.",
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
    type: "string",
    valueName: "mode",
    bareValue: "full",
    description:
      "Show help for the current topic or command and exit. Bare `--help` gives the full text: " +
      "prose, whole flag descriptions, worked examples. `--help=brief` gives the synopsis and " +
      "one line per argument and flag — the first sentence of each, so the two registers cannot " +
      "disagree — and nothing else. The value is inline-only, so `corpus doc list --help` " +
      "swallows nothing after it.",
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
