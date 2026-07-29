// Builds every plugin workspace that declares a `build` script, in directory
// order (PLUGINS-001, sprint-012 Adjudication 12: `npm run build` builds
// plugins after kit/contract — they import only those two — with compiled
// output landing in `plugins/<name>/dist/`). Generic on purpose: nothing here
// names a plugin, so adding one is `mkdir plugins/<name>` and a package.json.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const pluginsRoot = join(repoRoot, "plugins");

function hasBuildScript(pluginDir: string): boolean {
  const manifestPath = join(pluginsRoot, pluginDir, "package.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { scripts?: { build?: unknown } }).scripts?.build === "string"
    );
  } catch {
    return false;
  }
}

const plugins = existsSync(pluginsRoot)
  ? readdirSync(pluginsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter(hasBuildScript)
      .sort()
  : [];

for (const plugin of plugins) {
  process.stdout.write(`building plugin ${plugin}\n`);
  const result = spawnSync("npm", ["run", "build", "-w", `plugins/${plugin}`], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.stderr.write(`plugin ${plugin} failed to build\n`);
    process.exit(result.status ?? 1);
  }
}
