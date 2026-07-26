// Emits the committed contract artifacts: `openapi.json` and the generated
// client types. Run via `npm run generate -w packages/contract`; the pre-push
// drift check runs the same command and fails when the result differs from what
// is committed (SPEC.md §9.3).
import { relative } from "node:path";
import {
  CLIENT_TYPES_PATH,
  contractPackageRoot,
  OPENAPI_JSON_PATH,
  writeContractArtifacts,
} from "../src/generation/artifacts.js";

const packageRoot = contractPackageRoot();
await writeContractArtifacts(packageRoot);

const here = relative(process.cwd(), packageRoot) || ".";
process.stdout.write(
  `generated ${here}/${OPENAPI_JSON_PATH}\ngenerated ${here}/${CLIENT_TYPES_PATH}\n`,
);
