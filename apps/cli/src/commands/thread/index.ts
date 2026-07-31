import type { TopicSpec } from "../../registry/types.js";
import { createCommand } from "./create.js";
import { replyCommand } from "./reply.js";
import { showCommand } from "./show.js";
import { reopenCommand, resolveCommand } from "./status.js";

/**
 * Conversations (SPEC.md §6, §8). A thread is itself a document — a file under
 * `data/threads/` with an anchor entry in whatever it comments on — but its
 * state is the server's: `show` reads one whole conversation, and the rest of
 * these verbs write to it.
 *
 * `create` covers all three of SPEC.md §6's creation shapes — anchored on a
 * quote, on a whole document, or standalone — because §7 binds the agent to this
 * CLI for _every_ interaction, and a surface that could only reply would leave
 * the agent unable to start a conversation about a document at all (CLI-022).
 * The quote is the anchor: a command line has no selection, so the caller names
 * the text and the server resolves it.
 */
export const threadTopic: TopicSpec = {
  name: "thread",
  summary: "Open conversations, read them, reply to them, and resolve them.",
  description:
    "A comment opens a thread anchored to the text it is about; every later turn appends to that " +
    "thread's file (SPEC.md §6). `create` opens one — on a quoted selection, on a whole document, " +
    "or standalone — `show` is the read §7's comment skill starts from (status, anchoring and " +
    "every turn), `reply` is the agent's half of the conversation, and `resolve`/`reopen` control " +
    "whether later turns keep waking it (SPEC.md §8).",
  commands: [createCommand, showCommand, replyCommand, resolveCommand, reopenCommand],
};
