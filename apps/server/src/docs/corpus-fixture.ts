// A real workspace on disk for the collection query's tests: real `.md` files
// under the real document roots, projected by the real projector.
//
// Nothing here fakes a row. Sprint-004 authorizes seeding through files rather
// than through `POST /api/docs` (the write endpoints are SERVER-005/006), and
// this is that substitute — so a query test that passes is a statement about
// what the server answers for a workspace someone could have typed by hand.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { QueueEventStatus } from "@corpus/contract";
import {
  openProjection,
  populateFromFiles,
  type ProjectionConfig,
  type ProjectionDb,
} from "../projection/index.js";

/** A text-quote selector as it is written in a commented document's frontmatter (SPEC.md §6). */
export interface SelectorSpec {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface DocSpec {
  readonly id: string;
  /** Workspace-relative path; defaults to `data/docs/<id>.md`. */
  readonly path?: string;
  readonly type?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly status?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly due?: string | null;
  readonly reviewed?: string | null;
  readonly evergreen?: boolean;
  readonly body?: string;
  /** Anchor entries keyed by anchor id, as the *commented* document carries them. */
  readonly anchors?: Readonly<Record<string, SelectorSpec>>;
  /**
   * Frontmatter keys written after the §5 block, exactly as a hand-written file
   * carries them: §11's view keys (`pinned`, `order`, `query`, `column`) and
   * §12's plugin keys (`items`, …) are both plain YAML keys beside the core
   * ones, so one escape hatch seeds both (CONTRACT-011).
   */
  readonly frontmatter?: Readonly<Record<string, unknown>>;
}

export interface TurnSpec {
  readonly author: "user" | "agent";
  readonly ts: string;
  readonly body: string;
}

export interface ThreadSpec extends DocSpec {
  readonly parent?: string | null;
  readonly anchor?: string | null;
  readonly agent?: "none" | "requested" | "engaged";
  readonly turns?: readonly TurnSpec[];
}

const DEFAULT_INSTANT = "2026-07-01T00:00:00Z";

const yamlValue = (value: string | null): string => (value === null ? "null" : value);

function frontmatterLines(spec: DocSpec, type: string): string[] {
  return [
    `id: ${spec.id}`,
    `type: ${type}`,
    `title: ${JSON.stringify(spec.title ?? spec.id)}`,
    `created: ${spec.created ?? DEFAULT_INSTANT}`,
    `updated: ${spec.updated ?? spec.created ?? DEFAULT_INSTANT}`,
    `tags: [${(spec.tags ?? []).join(", ")}]`,
    `status: ${spec.status ?? "open"}`,
    // JSON is valid YAML flow mapping, so the selectors need no hand-rolled
    // quoting rules to survive a body quote containing `:` or `#`.
    `anchors: ${JSON.stringify(spec.anchors ?? {})}`,
    `due: ${yamlValue(spec.due ?? null)}`,
    `reviewed: ${yamlValue(spec.reviewed ?? null)}`,
    `evergreen: ${String(spec.evergreen ?? false)}`,
    // JSON is a valid YAML flow scalar/collection, so any seeded value survives
    // without a hand-rolled quoting rule.
    ...Object.entries(spec.frontmatter ?? {}).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    ),
  ];
}

export function docMarkdown(spec: DocSpec): string {
  return [
    "---",
    ...frontmatterLines(spec, spec.type ?? "note"),
    "---",
    "",
    spec.body ?? "Body text.",
    "",
  ].join("\n");
}

export function threadMarkdown(spec: ThreadSpec): string {
  const turns = (spec.turns ?? []).flatMap((turn) => [
    `## ${turn.author} · ${turn.ts}`,
    "",
    turn.body,
    "",
  ]);
  return [
    "---",
    ...frontmatterLines(spec, "thread"),
    `parent: ${yamlValue(spec.parent ?? null)}`,
    `anchor: ${yamlValue(spec.anchor ?? null)}`,
    `agent: ${spec.agent ?? "none"}`,
    "---",
    "",
    ...(spec.body === undefined ? [] : [spec.body, ""]),
    ...turns,
  ].join("\n");
}

export interface Workspace {
  readonly root: string;
  readonly config: ProjectionConfig;
  readonly db: ProjectionDb;
  write(relativePath: string, content: string): void;
  doc(spec: DocSpec): string;
  thread(spec: ThreadSpec): string;
  seen(marks: Readonly<Record<string, string>>): void;
  /**
   * Writes one event file into `.corpus/queue/<status>/`, which is where the
   * queue's own state lives (SPEC.md §7) — the projection reads the directory,
   * so a fixture that wants an event in a given state puts it in that directory
   * rather than writing the row.
   */
  queuedEvent(
    status: QueueEventStatus,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ): void;
  /** Fails an event through the real queue directories, as `POST /api/queue/{id}/fail` leaves them. */
  failedEvent(id: string, payload: Readonly<Record<string, unknown>>): void;
  reproject(): void;
  close(): void;
}

/** A temp workspace with an open, empty projection. Call `reproject()` after seeding. */
export function createWorkspace(prefix: string): Workspace {
  const root = mkdtempSync(join(tmpdir(), `corpus-s011-${prefix}-`));
  const workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  mkdirSync(join(workspaceRoot, "data", "threads"), { recursive: true });
  const config: ProjectionConfig = {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
  };
  const db = openProjection(config, { populate: false });

  const write = (relativePath: string, content: string): void => {
    const abs = join(workspaceRoot, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };

  const queuedEvent = (
    status: QueueEventStatus,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ): void => {
    write(
      `.corpus/queue/${status}/${id}.json`,
      JSON.stringify({
        id,
        type: "comment.created",
        created: DEFAULT_INSTANT,
        source: "cli",
        payload,
      }),
    );
  };

  return {
    root,
    config,
    db,
    write,
    doc(spec) {
      write(spec.path ?? `data/docs/${spec.id}.md`, docMarkdown(spec));
      return spec.id;
    },
    thread(spec) {
      write(spec.path ?? `data/threads/${spec.id}.md`, threadMarkdown(spec));
      return spec.id;
    },
    seen(marks) {
      write(".corpus/seen.json", JSON.stringify(marks, null, 2));
    },
    queuedEvent,
    failedEvent(id, payload) {
      queuedEvent("failed", id, payload);
    },
    reproject() {
      populateFromFiles(db);
    },
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
