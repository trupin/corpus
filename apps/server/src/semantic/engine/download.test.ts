import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchLike } from "../http-provider.js";
import {
  artifactPath,
  downloadArtifact,
  inspectArtifact,
  ModelDownloadError,
  readVerifiedArtifact,
} from "./download.js";
import type { ModelArtifact } from "./manifest.js";

const PAYLOAD = new TextEncoder().encode("the quick brown fox embeds the lazy dog");
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const ARTIFACT: ModelArtifact = {
  name: "weights.bin",
  url: "https://example.invalid/weights.bin",
  sha256: sha256(PAYLOAD),
  bytes: PAYLOAD.byteLength,
};

const respondWith =
  (body: Uint8Array | string | null, init?: ResponseInit): FetchLike =>
  () =>
    Promise.resolve(new Response(body, init));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "corpus-model-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const leftovers = async (): Promise<string[]> => (await readdir(dir)).sort();

describe("downloadArtifact", () => {
  it("writes the artifact under its final name once length and digest both match", async () => {
    await downloadArtifact({ artifact: ARTIFACT, dir, fetchFn: respondWith(PAYLOAD) });

    expect(await readFile(artifactPath(dir, ARTIFACT))).toEqual(Buffer.from(PAYLOAD));
    expect(await leftovers()).toEqual(["weights.bin"]);
  });

  it("reports progress as bytes arrive, never past the pinned total", async () => {
    const seen: number[] = [];
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PAYLOAD.slice(0, 10));
        controller.enqueue(PAYLOAD.slice(10));
        controller.close();
      },
    });

    await downloadArtifact({
      artifact: ARTIFACT,
      dir,
      fetchFn: () => Promise.resolve(new Response(chunked)),
      onProgress: (progress) => {
        expect(progress.total).toBe(ARTIFACT.bytes);
        seen.push(progress.received);
      },
    });

    expect(seen).toEqual([10, ARTIFACT.bytes]);
  });

  it("discards a truncated download and says so", async () => {
    await expect(
      downloadArtifact({ artifact: ARTIFACT, dir, fetchFn: respondWith(PAYLOAD.slice(0, 12)) }),
    ).rejects.toThrow(/truncated/);

    expect(await leftovers()).toEqual([]);
  });

  it("cuts off a response longer than the pin instead of filling the disk", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096));
      },
    });

    await expect(
      downloadArtifact({
        artifact: ARTIFACT,
        dir,
        fetchFn: () => Promise.resolve(new Response(endless)),
      }),
    ).rejects.toThrow(/longer than the pinned/);

    expect(await leftovers()).toEqual([]);
  });

  it("discards a download of the right length whose digest is wrong", async () => {
    const tampered = new Uint8Array(PAYLOAD);
    tampered[0] = 88;

    await expect(
      downloadArtifact({ artifact: ARTIFACT, dir, fetchFn: respondWith(tampered) }),
    ).rejects.toThrow(/does not match the pinned/);

    expect(await leftovers()).toEqual([]);
  });

  it("reports an HTTP failure without writing anything", async () => {
    await expect(
      downloadArtifact({ artifact: ARTIFACT, dir, fetchFn: respondWith("nope", { status: 503 }) }),
    ).rejects.toThrow(/HTTP 503/);

    expect(await leftovers()).toEqual([]);
  });

  it("reports a bodyless response", async () => {
    await expect(
      downloadArtifact({ artifact: ARTIFACT, dir, fetchFn: respondWith(null, { status: 204 }) }),
    ).rejects.toThrow(/no body/);
  });

  it("passes the abort signal through to fetch", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadArtifact({
        artifact: ARTIFACT,
        dir,
        signal: controller.signal,
        fetchFn: (_input, init) =>
          init.signal?.aborted === true
            ? Promise.reject(new Error("aborted"))
            : Promise.resolve(new Response(PAYLOAD)),
      }),
    ).rejects.toThrow(/aborted/);
  });
});

describe("inspectArtifact", () => {
  it("distinguishes absent, present and wrong-sized", async () => {
    expect(await inspectArtifact(dir, ARTIFACT)).toBe("absent");

    await writeFile(artifactPath(dir, ARTIFACT), PAYLOAD.slice(0, 5));
    expect(await inspectArtifact(dir, ARTIFACT)).toBe("damaged");

    await writeFile(artifactPath(dir, ARTIFACT), PAYLOAD);
    expect(await inspectArtifact(dir, ARTIFACT)).toBe("present");
  });

  it("calls a directory standing where the artifact belongs damaged, not present", async () => {
    await mkdir(artifactPath(dir, ARTIFACT));
    expect(await inspectArtifact(dir, ARTIFACT)).toBe("damaged");
  });
});

describe("readVerifiedArtifact", () => {
  it("returns the bytes when they hash to the pin", async () => {
    await writeFile(artifactPath(dir, ARTIFACT), PAYLOAD);
    expect(await readVerifiedArtifact(dir, ARTIFACT)).toEqual(PAYLOAD);
  });

  it("deletes and refuses a same-length file whose bytes were tampered with", async () => {
    const tampered = new Uint8Array(PAYLOAD);
    tampered[3] = 0;
    await writeFile(artifactPath(dir, ARTIFACT), tampered);

    await expect(readVerifiedArtifact(dir, ARTIFACT)).rejects.toThrow(ModelDownloadError);
    // Discarded, so the next index run downloads it again instead of failing forever.
    expect(await leftovers()).toEqual([]);
  });

  it("reports a missing artifact rather than returning empty bytes", async () => {
    await expect(readVerifiedArtifact(dir, ARTIFACT)).rejects.toThrow(/could not be read/);
  });
});
