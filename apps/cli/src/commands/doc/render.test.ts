import { describe, expect, it } from "vitest";
import { ExitCode, renderError, StaleKeyError } from "../../errors.js";
import { DOC, rekeyed } from "./fixtures.js";
import { staleKeyError } from "./render.js";

/**
 * SPEC.md §7's refusal, and the two recoveries it has to be able to name.
 *
 * The regression these tests exist for (PR #44 re-review): the refusal is
 * classified once, in `client.ts`, for *every* route — so the keyed message
 * reached `corpus doc patch`, a verb with no `--key`, and told an agent to
 * re-run "with `--key <k>`". A flag that verb refuses at exit 2. The assertions
 * below are therefore as much about what each message must **not** say as about
 * what it says: an agent recovers from the message alone or it does not recover.
 */

const MOVED_ON = rekeyed(DOC, "c0ffee11223344556677889900aabbccddeeff00112233445566778899aabbcc");

/** Everything an agent actually reads, in the shape `renderError` prints it. */
const humanText = (error: StaleKeyError): string => renderError(error, { verbose: false });

describe("staleKeyError — the keyed refusal", () => {
  it("names the fresh key and the flag to resend it in", () => {
    const error = staleKeyError(409, MOVED_ON);

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(error.exitCode).toBe(ExitCode.staleKey);
    expect(error.status).toBe(409);
    expect(error.changed).toBe(false);
    expect(error.hint).toContain(`--key ${MOVED_ON.key}`);
    expect(error.message).toContain("nothing was written");
  });

  it("is what a caller gets when the route is not named at all", () => {
    // The default is keyed because every write but one presents a key: the
    // exception has to ask for itself.
    expect(staleKeyError(409, MOVED_ON).hint).toBe(
      staleKeyError(409, MOVED_ON, { keyed: true }).hint,
    );
  });

  it("prints the document as `corpus doc show` would, so the caller can reconcile", () => {
    const text = humanText(staleKeyError(409, MOVED_ON));

    expect(text).toContain(MOVED_ON.frontmatter.title);
    expect(text).toContain(`key ${MOVED_ON.key}`);
    expect(text).toContain(MOVED_ON.body.trim());
    // Rendered as a document, never as a JSON dump of `details`.
    expect(text).not.toContain('"frontmatter"');
  });

  it("carries the document un-rendered for `--json`", () => {
    expect(staleKeyError(409, MOVED_ON).details).toBe(MOVED_ON);
  });
});

describe("staleKeyError — the refusal of the verb that presents no key", () => {
  it("never mentions `--key`, because `corpus doc patch` has none", () => {
    // The regression, asserted directly: §7 exempts a patch, and the CLI
    // refuses a `--key` on it at exit 2, so a recovery that names the flag is a
    // dead end for the agent following it.
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.message).not.toContain("--key");
    expect(error.hint).not.toContain("--key");
    expect(humanText(error)).not.toContain("--key");
    expect(humanText(error)).not.toContain(MOVED_ON.key);
  });

  it("says the patch is still good and to run the same one again", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.message).toContain("outside Corpus");
    expect(error.message).toContain("nothing was written");
    expect(error.message).toContain("the patch itself is still good");
    expect(error.hint).toContain("Run the same patch again");
  });

  it("names the second step too: exit 10 means the quote is gone, so re-read", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error.hint).toContain("exit 10");
    expect(error.hint).toContain(`corpus doc show ${MOVED_ON.frontmatter.id}`);
  });

  it("keeps the classification of the keyed refusal — same code, same exit, nothing written", () => {
    const error = staleKeyError(409, MOVED_ON, { keyed: false });

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(error.code).toBe("stale_key");
    expect(error.exitCode).toBe(ExitCode.staleKey);
    expect(error.status).toBe(409);
    expect(error.changed).toBe(false);
  });

  it("prints no document: the bounded edit does not pay for the whole file to be refused", () => {
    const text = humanText(staleKeyError(409, MOVED_ON, { keyed: false }));

    expect(text).not.toContain(MOVED_ON.body.trim());
    expect(text).not.toContain(MOVED_ON.path);
    expect(text).not.toContain(MOVED_ON.frontmatter.title);
    // And not as a JSON dump either — an empty `detailLines` is what stops
    // `renderError` falling back to stringifying `details`.
    expect(text).not.toContain('"frontmatter"');
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("still carries the document for `--json`, which asked for structure", () => {
    // Dropping it from the human rendering is a token decision, not a data one:
    // a machine caller that wants to check its excerpt against the new body
    // before retrying reads `.error.details.body`.
    expect(staleKeyError(409, MOVED_ON, { keyed: false }).details).toBe(MOVED_ON);
  });
});
