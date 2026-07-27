// Emits the committed CLI reference `docs/cli.md` from the command registry.
// Run via `npm run docs:cli -w apps/cli`; the generated-artifact drift check
// runs the same command and fails when the result differs from what is
// committed (SPEC.md §2.3).
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { CLI_DOCS_RELATIVE_PATH, generateCliDocs } from "../src/docs/generate.js";
import { registry } from "../src/registry/index.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const target = resolve(repoRoot, CLI_DOCS_RELATIVE_PATH);

writeFileSync(target, generateCliDocs(registry), "utf8");

process.stdout.write(`generated ${relative(process.cwd(), target) || CLI_DOCS_RELATIVE_PATH}\n`);
