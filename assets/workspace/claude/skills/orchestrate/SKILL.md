---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim queue events, route each one to a handler, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

This skill is a skeleton: it carries the sections the loop will be written into, and no
behavior yet. The instructions arrive with AGENT-002.

## Invariants

Every mutation goes through the `corpus` CLI — workspace files are never hand-edited and the
HTTP API is never called directly. The remaining invariants arrive with AGENT-002.

## The loop

Arrives with AGENT-002.

## Routing

Arrives with AGENT-002.

## Job logs

Arrives with AGENT-002.

## HALT

Arrives with AGENT-002.

## Stewardship

Arrives with AGENT-002.

## Worked example

Arrives with AGENT-002.
