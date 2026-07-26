---
name: comment
description: Handle a comment that requested the agent — read the thread and its anchored context, do what the comment asks, and reply through the corpus CLI. Invoked by the orchestrate skill for comment.created and form.respond events.
id: doc_skillcomment
type: skill
title: Comment
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

This skill is a skeleton: it carries the sections comment handling will be written into, and
no behavior yet. The instructions arrive with AGENT-003.

## Invariants

Every mutation goes through the `corpus` CLI — workspace files are never hand-edited and the
HTTP API is never called directly. The remaining invariants arrive with AGENT-003.

## Gather context

Arrives with AGENT-003.

## Inbox filing

Arrives with AGENT-003.

## Reply

Arrives with AGENT-003.

## Forms

Arrives with AGENT-003.

## Skill genesis

Arrives with AGENT-003.

## Worked example

Arrives with AGENT-003.
