---
title: Argus by Insidia Labs
summary: Argus is the free, open-source dynamic scanner from my company Insidia Labs. It tests a running app or API, adds AI-app checks mapped to the OWASP LLM Top 10, and produces one report.
date: 2026-09-28
featured: true
draft: false
tags:
  - AI Security
  - Application Security
  - Open Source
repositoryUrl: https://github.com/Rushi-Balapure/Insidia-Labs
demoUrl: https://insidialabs.com
stack:
  - Python
  - CLI
  - nuclei
  - katana
  - httpx
  - SARIF
role: Founder
priority: 200
status: live
---

I founded Insidia Labs, a security company, and built Argus as its first product: a free, open-source dynamic scanner. It is live under Apache 2.0. The CLI runs on your machine against a running app or API that you configure; it is not a static code analyser.

## From scan to review

- Configure the targets and allowed hosts you want to test.
- Run a baseline scan. Argus drives nuclei, katana, and httpx, and adds AI-app checks mapped to the OWASP LLM Top 10.
- Review findings, supporting evidence, remediation guidance, and skipped checks in one report.
- Export HTML for review, JSON for scripts and coding agents, or SARIF for CI code scanning.
- Rerun checks after a fix to review what changed.

## Engineering focus

Argus brings established web scanners and AI-app checks into one reporting workflow. Coverage depends on the target and the tools available; reports identify what ran and what was skipped.

## What comes next

Lynx, a planned autonomous-agent pentesting product from Insidia Labs, is still in design. Lynx Pro is targeted for mid-December 2026 and its safety scope is not final, so it is not released.

Explore the [website](https://insidialabs.com), [documentation](https://insidialabs.com/docs/), or [open-source entry](/open-source/insidia-labs/).
