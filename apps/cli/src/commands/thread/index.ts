import type { TopicSpec } from "../../registry/types.js";
import { replyCommand } from "./reply.js";
import { showCommand } from "./show.js";
import { reopenCommand, resolveCommand } from "./status.js";

/**
 * Conversations (SPEC.md §6, §8). A thread is itself a document — a file under
 * `data/threads/` with an anchor entry in whatever it comments on — but its
 * state is the server's: `show` reads one whole conversation, and the rest of
 * these verbs write to it.
 *
 * Thread creation has no verb here on purpose: a thread is anchored to a
 * selection in a document, which is a thing the UI's selection carries and a
 * command line does not. The agent replies to conversations it was invited to.
 */
export const threadTopic: TopicSpec = {
  name: "thread",
  summary: "Read conversations, reply to them, and open or close them.",
  description:
    "A comment opens a thread anchored to the text it is about; every later turn appends to that " +
    "thread's file (SPEC.md §6). `show` is the read §7's comment skill starts from — status, " +
    "anchoring and every turn — `reply` is the agent's half of the conversation, and " +
    "`resolve`/`reopen` control whether later turns keep waking it (SPEC.md §8).",
  commands: [showCommand, replyCommand, resolveCommand, reopenCommand],
};
