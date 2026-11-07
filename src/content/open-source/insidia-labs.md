---
title: Argus by Insidia Labs
summary: Argus is the free, open-source (Apache 2.0) dynamic scanner from Insidia Labs. A local CLI tests running apps and APIs, adds AI-app checks mapped to the OWASP LLM Top 10, and writes HTML, JSON, and SARIF reports.
date: 2026-09-28
featured: true
draft: false
tags:
  - Python
  - AI Security
  - Open Source
organization: Insidia Labs
status: live
repositoryUrl: https://github.com/Rushi-Balapure/Insidia-Labs
contributionSummary: Founded Insidia Labs and develop Argus, including its CLI, scan workflow, reports, and documentation.
impact: Gives developers a free, open-source way to scan a running app or API and review the evidence in one report, locally or in CI.
---

Argus is the open-source dynamic scanner from Insidia Labs, my company. It is live under Apache 2.0 and runs against a running app or API rather than analysing source code.

## What I am building

- A Python CLI for configuring targets and allowed hosts, running a baseline scan, and rerunning checks after fixes.
- Web and API scanning that drives nuclei, katana, and httpx, plus AI-app checks mapped to the OWASP LLM Top 10.
- One report that brings together findings, evidence, remediation guidance, and skipped checks.
- HTML reports for review, JSON output for automation, and SARIF output for CI code scanning.
- Documentation for installation, target configuration, scan scope, and report interpretation.

## Working in public

The project accepts contributions through its [contribution guide](https://github.com/Rushi-Balapure/Insidia-Labs/blob/main/CONTRIBUTING.md), with vulnerability disclosures handled through the [security policy](https://github.com/Rushi-Balapure/Insidia-Labs/blob/main/SECURITY.md).

Coverage varies by target and available tools, and skipped checks stay visible in reports. Lynx, a planned autonomous-agent pentesting product from Insidia Labs, is still in design and is not released.

Read the [documentation](https://insidialabs.com/docs/) or explore the [project overview](/projects/insidia-labs/).
