---
name: fixture-notes
description: Test-only skill installed by the _fixture plugin to prove plugin skills reach the workspace's .claude/skills at corpus init.
---

# Fixture notes

This skill ships with the test-only `_fixture` plugin (PLUGINS-001). Events of
type `_fixture.*` route here by the orchestrate skill's generic
`<plugin>.<action>` convention.

When asked to record a fixture note, create it through the plugin's CLI verb:

```
corpus _fixture add "<title>"
```

Nothing else. The real reference plugin skill ships with `todos`
(PLUGINS-002).
