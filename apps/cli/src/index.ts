/** Public surface of `@corpus/cli`: the run loop plus the registry it dispatches from. */
export const PACKAGE_NAME = "@corpus/cli";

export { run, type RunOptions } from "./run.js";
export { registry } from "./registry/index.js";
export type {
  ArgSpec,
  CommandContext,
  CommandSpec,
  Example,
  FlagSpec,
  FlagType,
  Registry,
  StandaloneCommandSpec,
  TopicSpec,
  WorkspaceCommandContext,
  WorkspaceCommandSpec,
} from "./registry/types.js";
export { GLOBAL_FLAGS } from "./registry/globals.js";
export {
  collectRegistryProblems,
  RegistryValidationError,
  validateRegistry,
} from "./registry/validate.js";
export { generateCliDocs, CLI_DOCS_RELATIVE_PATH } from "./docs/generate.js";
export {
  CliError,
  CheckFailedError,
  ExitCode,
  EXIT_CODES,
  InternalError,
  ServerResponseError,
  ServerUnreachableError,
  UsageError,
  WorkspaceConfigError,
  WorkspaceNotFoundError,
  exitCodeFor,
  isCliError,
  renderError,
  toProblem,
  type CliProblem,
} from "./errors.js";
export { readPackageVersion, cliPackageRoot } from "./version.js";
export {
  findWorkspaceRoot,
  readWorkspaceConfig,
  resolveWorkspace,
  WorkspaceConfigSchema,
  type Workspace,
  type WorkspaceConfig,
} from "./workspace.js";
export { createClient, type CliClient } from "./client.js";
