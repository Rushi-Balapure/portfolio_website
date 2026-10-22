---
title: Insidia Labs
summary: Security testing for AI apps, agents, web apps, and APIs. A local Python CLI brings scans, evidence, coverage, and remediation guidance into one review workflow.
date: 2026-09-28
featured: true
draft: false
tags:
  - AI Security
  - Application Security
  - Developer Tools
repositoryUrl: https://github.com/Rushi-Balapure/Insidia-Labs
demoUrl: https://insidialabs.com
stack:
  - Python
  - CLI
  - YAML
  - SARIF
role: Creator
priority: 200
status: in-progress
---

I created Insidia Labs to bring AI and application security testing into the same development workflow. The CLI runs on your machine, scans the targets you configure, and produces reports you can review before shipping or after making a fix.

## From scan to review

- Configure application targets and allowed hosts in `insidia.yaml`.
- Check the setup with `insidia doctor`, then run the baseline L1 policy.
- Review findings, supporting evidence, remediation guidance, and skipped checks in an HTML report.
- Export JSON for scripts and coding agents, or SARIF for CI code scanning.
- Rerun checks after a fix to review what changed.

## Engineering focus

Insidia brings built-in probes and optional security engines into one reporting workflow. Its scope spans prompt injection and data leakage alongside web, API, and repository security checks. Coverage depends on the target and installed engines; reports identify what ran and what was skipped.

The project is under active development. Some checks currently work only against the project's test apps, and external engine integrations remain experimental.

The CLI is open source under Apache 2.0. Explore the [website](https://insidialabs.com), [documentation](https://insidialabs.com/docs/), or [open-source entry](/open-source/insidia-labs/).
