---
name: fixture-notes
description: Test-only skill installed by the _fixture plugin to prove plugin skills reach the workspace's .claude/skills at corpus init.
---

# Fixture notes

This skill ships with the test-only `_fixture` plugin (PLUGINS-001). It is
reached **by name** — a `/fixture-notes` request in a thread — and not by event
type: the orchestrate skill sends `<plugin>.<action>` to the skill installed at
`.claude/skills/<plugin>/`, and this one installs at `.claude/skills/fixture-notes/`
because its skill directory is named for the note it makes rather than for the
plugin that ships it. A plugin that wants its events routed names its skill
directory after its plugin directory, the way `todos` does.

When asked to record a fixture note, create it through the plugin's CLI verb:

```
corpus _fixture add "<title>" --from agent
```

`--from` defaults to `user` on every verb, plugin verbs included, so a write
that omits it is attributed to the person who did not make it.

Then report back in the thread the way any other skill does: the comment skill's
reply rules — a reply always, naming what was created by `[[id]]`, closing with a
trace line because this turn wrote — apply here unchanged and are not restated.
This plugin does nothing else; the real reference plugin skill ships with `todos`
(PLUGINS-002).
