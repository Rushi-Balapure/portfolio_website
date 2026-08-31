---
title: Hands-on LLM Security Workshop
summary: An offensive-and-defensive workshop on testing LLM applications, exploiting common weaknesses, and designing safer AI systems.
date: 2026-05-19
featured: true
draft: false
tags:
  - LLM Security
  - Red Teaming
  - Prompt Injection
  - Secure AI
eventOrOrganization: PICT Cyber Cell
location: PICT Pune, India
relatedLinks:
  - label: LinkedIn workshop recap
    url: https://www.linkedin.com/posts/rushi-balapure-75148022a_llmsecurity-cybersecurity-genai-activity-7462376277467959296-kP2B
  - label: Open-source workshop materials
    url: https://github.com/Rushi-Balapure/LLM_Security_Workshop
---

Returned to Pune Institute of Computer Technology as a guest speaker for a hands-on workshop hosted by the PICT Cyber Cell.

## What the workshop covered

- **Threat foundations:** OWASP Top 10 for LLM Applications, MITRE ATLAS, and how language-model threat boundaries differ from traditional software.
- **Automated testing:** Vulnerability scanning and red teaming with tools including Garak and Promptfoo.
- **Prompt injection:** Direct attacks and indirect attacks delivered through data retrieved by RAG systems.
- **Excessive agency:** Exploiting autonomous agents and unsafe tool access.
- **Defensive design:** Context minimization, action-selector patterns, and why prompt-only defenses are insufficient.

Participants ran the exercises locally with Python, Ollama, and an intentionally vulnerable model. The complete guide, lesson material, code samples, offensive exercises, and secure-agent examples are available in the public workshop repository.
