import { describe, expect, it } from "vitest";
import {
  auditPackedFiles,
  FORBIDDEN_PACK_PATTERNS,
  MAXIMUM_PACKED_BYTES,
  MINIMUM_PACKED_FILES,
  REQUIRED_PACK_ENTRIES,
  type PackedFile,
} from "./pack-audit.js";

const READ_ONLY = 0o644;
const EXECUTABLE = 0o755;

/**
 * A minimal well-formed tarball listing — everything the installed tool
 * resolves, and nothing else. Every negative test below is this list plus one
 * offending entry, so a failure names the entry, not the fixture.
 */
function cleanListing(extra: readonly PackedFile[] = []): PackedFile[] {
  const files: PackedFile[] = [
    { path: "package.json", mode: READ_ONLY },
    { path: "README.md", mode: READ_ONLY },
    { path: "LICENSE", mode: READ_ONLY },
    { path: "dist/corpus.js", mode: EXECUTABLE },
    { path: "server/main.js", mode: READ_ONLY },
    { path: "ui/index.html", mode: READ_ONLY },
    { path: "ui/assets/index-BjxWPzh4.js", mode: READ_ONLY },
    { path: "ui/assets/index-DxfOQDDq.css", mode: READ_ONLY },
    { path: "assets/workspace/README.md", mode: READ_ONLY },
    { path: "assets/workspace/gitignore", mode: READ_ONLY },
    { path: "assets/workspace/claude/skills/orchestrate/SKILL.md", mode: READ_ONLY },
    { path: "assets/workspace/claude/skills/comment/SKILL.md", mode: READ_ONLY },
    { path: "assets/workspace/data/docs/templates/note.md", mode: READ_ONLY },
    { path: "assets/workspace/data/docs/views/attention.md", mode: READ_ONLY },
    { path: "assets/workspace/data/docs/views/inbox.md", mode: READ_ONLY },
    { path: "assets/workspace/data/docs/views/open-threads.md", mode: READ_ONLY },
  ];
  return [...files, ...extra];
}

describe("a well-formed tarball", () => {
  it("passes", () => {
    expect(auditPackedFiles(cleanListing())).toEqual([]);
  });

  it("is above the floor that catches an unstaged package", () => {
    expect(cleanListing().length).toBeGreaterThanOrEqual(MINIMUM_PACKED_FILES);
  });
});

describe("the positive half", () => {
  it("fails on an empty listing — the reason a negative-only check is worthless", () => {
    const violations = auditPackedFiles([]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain("nothing was staged");
  });

  it.each([
    ["the bin", "dist/corpus.js"],
    ["the server entry", "server/main.js"],
    ["the board's entry document", "ui/index.html"],
    [
      "the workspace template's orchestrate skill",
      "assets/workspace/claude/skills/comment/SKILL.md",
    ],
    ["the README", "README.md"],
    ["the LICENSE", "LICENSE"],
  ])("fails when %s is missing", (_label, missing) => {
    const files = cleanListing().filter((file) => file.path !== missing);
    expect(auditPackedFiles(files).join("\n")).toContain(missing);
  });

  it("fails when index.html ships without its hashed script bundle", () => {
    const files = cleanListing().filter(
      (file) =>
        !file.path.endsWith(".js") ||
        file.path === "dist/corpus.js" ||
        file.path === "server/main.js",
    );
    expect(auditPackedFiles(files).join("\n")).toContain("ui/assets/*.js");
  });

  it("fails when a seed view is missing (the count, not the names, is asserted)", () => {
    const files = cleanListing().filter(
      (file) => file.path !== "assets/workspace/data/docs/views/inbox.md",
    );
    expect(auditPackedFiles(files).join("\n")).toContain("assets/workspace/data/docs/views/*.md");
  });
});

describe("the negative half", () => {
  it.each([
    ["a test file", "server/lifecycle.test.js"],
    ["a vendored dependency", "node_modules/hono/package.json"],
    ["the issue tracker", "issues/README.md"],
    ["the design mockup", "design/index.html"],
    ["the dev harness", ".claude/agents/infra-dev.md"],
    ["a git hook", ".githooks/pre-push"],
    ["CI configuration", ".github/workflows/ci.yml"],
    ["workspace documents", "data/docs/inbox/note.md"],
    ["workspace runtime state", ".corpus/config.json"],
    ["an environment file", ".env"],
    ["coverage output", "coverage/merged/index.html"],
    ["a source map", "ui/assets/index-BjxWPzh4.js.map"],
    ["a TypeScript source", "server/lifecycle.ts"],
    ["incremental build state", "dist/tsconfig.tsbuildinfo"],
  ])("rejects %s", (_label, offending) => {
    const violations = auditPackedFiles(cleanListing([{ path: offending, mode: READ_ONLY }]));
    expect(violations.join("\n")).toContain(offending);
  });

  it("rejects a `.test.ts` even in a plugin's staged output", () => {
    const violations = auditPackedFiles(
      cleanListing([{ path: "plugins/todos/dist/server/routes.test.js", mode: READ_ONLY }]),
    );
    expect(violations.join("\n")).toContain("routes.test.js");
  });
});

/**
 * sprint-013 Adjudication 15 / TEST-64: the rule has to be proven in **both**
 * directions. A rule that excluded every plugin would pass the exclusion test
 * while being completely broken, so the admission half is asserted too.
 *
 * `plugins/todos` (PLUGINS-002) is the first real subject: sprint-014
 * TEST-290 drives the same two directions against an actual packed tarball,
 * and the listings below stay as the unit-level guard on the rule itself.
 */
describe("the plugin rule", () => {
  it("admits a built non-underscore plugin", () => {
    const violations = auditPackedFiles(
      cleanListing([
        { path: "plugins/todos/dist/server/routes.js", mode: READ_ONLY },
        { path: "plugins/todos/dist/cli/commands/add.js", mode: READ_ONLY },
        { path: "plugins/todos/types.yaml", mode: READ_ONLY },
        { path: "plugins/todos/skills/todos/SKILL.md", mode: READ_ONLY },
      ]),
    );
    expect(violations).toEqual([]);
  });

  it("denies an underscore-prefixed dev fixture", () => {
    const violations = auditPackedFiles(
      cleanListing([{ path: "plugins/_fixture/dist/server/routes.js", mode: READ_ONLY }]),
    );
    expect(violations.join("\n")).toContain("plugins/_fixture/dist/server/routes.js");
  });
});

describe("the bin's executable bit", () => {
  it("fails when the bin is packed without one", () => {
    const files = cleanListing().map((file) =>
      file.path === "dist/corpus.js" ? { path: file.path, mode: READ_ONLY } : file,
    );
    expect(auditPackedFiles(files).join("\n")).toContain("is not executable");
  });

  it("fails when npm reported no mode at all", () => {
    const files = cleanListing().map((file) =>
      file.path === "dist/corpus.js" ? { path: file.path } : file,
    );
    expect(auditPackedFiles(files).join("\n")).toContain("executable bit is unproven");
  });
});

/**
 * INFRA-012, sprint-021 OC1-REVISED + OC2. The semantic stack ships as *absence*
 * — no weights, no tokenizer, no wasm, no native vector extension — and the
 * thing that makes that checkable is this table plus the byte ceiling. Each case
 * below is a real path from the artifacts the sprint measured and refused.
 */
describe("the semantic absence proof", () => {
  it.each([
    ["the embedding model itself", "assets/models/all-MiniLM-L6-v2/model_quantized.onnx"],
    ["fp32 weights under any name", "server/model.onnx"],
    ["external tensor data", "server/model.onnx_data"],
    ["a GGUF checkpoint", "assets/models/model.gguf"],
    ["safetensors weights", "assets/models/model.safetensors"],
    ["an opaque weights blob", "assets/models/pytorch_model.bin"],
    ["the tokenizer that downloads beside the weights", "assets/models/tokenizer.json"],
    ["a tokenizer config sidecar", "assets/models/tokenizer_config.json"],
    ["a special-tokens sidecar", "assets/models/special_tokens_map.json"],
    ["a model vocabulary", "assets/models/vocab.txt"],
    ["a populated model cache", "models/all-MiniLM-L6-v2@751bff37/model_quantized.onnx"],
    ["a dev cache directory", ".cache/corpus/models/tokenizer.json"],
    ["a native addon", "server/better_sqlite3.node"],
    ["a sqlite-vec extension, macOS", "server/vec0.dylib"],
    ["a sqlite-vec extension, Linux", "server/vec0.so"],
    ["a versioned shared object", "server/libonnxruntime.so.1.27.0"],
    ["a Windows DLL", "server/onnxruntime.dll"],
    ["a vendored wasm runtime", "server/ort-wasm-simd-threaded.wasm"],
  ])("rejects %s", (_label, offending) => {
    const violations = auditPackedFiles(cleanListing([{ path: offending, mode: READ_ONLY }]));
    expect(violations.join("\n")).toContain(offending);
  });

  it("catches an artifact renamed out of every pattern, by weight alone", () => {
    // 21.9 MiB — the int8 MiniLM, disguised. The named rules all miss it.
    const violations = auditPackedFiles(
      cleanListing([{ path: "assets/workspace/data/blob", mode: READ_ONLY, size: 22_972_370 }]),
    );
    expect(violations.join("\n")).toContain("ceiling");
  });

  it("leaves a real-sized tarball alone", () => {
    const files = cleanListing().map((file) => ({ ...file, size: 200_000 }));
    expect(files.reduce((total, file) => total + file.size, 0)).toBeLessThan(MAXIMUM_PACKED_BYTES);
    expect(auditPackedFiles(files)).toEqual([]);
  });
});

describe("the rule tables", () => {
  it("every rule carries a reason, because the reason is the failure message", () => {
    for (const entry of REQUIRED_PACK_ENTRIES) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.min).toBeGreaterThan(0);
    }
    for (const entry of FORBIDDEN_PACK_PATTERNS) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("anchors the workspace-data bans at the package root so the template's data/ still ships", () => {
    const patterns = FORBIDDEN_PACK_PATTERNS.map((entry) => entry.pattern);
    expect(patterns).toContain("data/**");
    expect(patterns).not.toContain("**/data/**");
    expect(auditPackedFiles(cleanListing())).toEqual([]);
  });
});
