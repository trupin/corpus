/**
 * `@corpus/kit/testing` — doubles for the things a kit consumer cannot get from
 * its test runner.
 *
 * A separate entry point on purpose: none of this belongs in the plugin
 * contract's runtime surface, but every consumer of that contract needs it,
 * because there is no real `EventSource` to test against. Node gates
 * `EventSource` behind `--experimental-eventsource` (absent on both Node 22 and
 * 25) and jsdom implements none at all. Without an injected factory a mounted
 * `CorpusProvider` spends the whole test backing off against a constructor that
 * does not exist — noise unrelated to whatever is under test.
 *
 * The real connection is proven where the evidence is worth something: a real
 * browser against a real server.
 */

export {
  FakeEventSource,
  fakeEventSourceFactory,
  failingEventSourceFactory,
  type RecordingEventSourceFactory,
} from "./fakeEventSource.js";
export {
  createCorpusTestHarness,
  type CorpusTestHarness,
  type CorpusTestHarnessOptions,
} from "./harness.js";
