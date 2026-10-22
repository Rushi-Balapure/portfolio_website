---
title: Insidia Labs
summary: An Apache 2.0 security-testing toolkit for AI apps and the applications around them, with a local CLI, coding-agent skill, and HTML, JSON, and SARIF reports.
date: 2026-09-28
featured: true
draft: false
tags:
  - Python
  - AI Security
  - Open Source
organization: Insidia Labs
repositoryUrl: https://github.com/Rushi-Balapure/Insidia-Labs
contributionSummary: Created Insidia Labs and develop its Python CLI, scan workflow, reports, documentation, and coding-agent skill.
impact: Makes local security scans and evidence available for developer review and CI workflows without requiring an account.
---

Insidia Labs is my open-source project for testing AI apps, agents, and the web apps and APIs around them. The source is available under Apache 2.0, and the CLI runs locally without requiring an account.

## What I am building

- A Python CLI for configuring targets, checking prerequisites, running scans, and rerunning checks after fixes.
- Reports that bring together findings, evidence, remediation guidance, engine attribution, and skipped checks.
- HTML reports for review, JSON output for automation, and SARIF output for CI code scanning.
- A coding-agent skill for setting up scans and reviewing results from an existing development workflow.
- Documentation for installation, target configuration, scan scope, and report interpretation.

## Working in public

The project accepts contributions through its [contribution guide](https://github.com/Rushi-Balapure/Insidia-Labs/blob/main/CONTRIBUTING.md), with vulnerability disclosures handled through the [security policy](https://github.com/Rushi-Balapure/Insidia-Labs/blob/main/SECURITY.md).

Coverage varies by target and installed engines. Some checks are currently limited to the project's test apps, and external integrations are experimental; skipped checks remain visible in reports.

Read the [documentation](https://insidialabs.com/docs/) or explore the [project overview](/projects/insidia-labs/).
