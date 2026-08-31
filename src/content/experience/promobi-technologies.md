---
title: Associate Product Engineer
summary: Building enterprise security products across Cloud DSPM, Secure Web Gateway, and Data Loss Prevention at ProMobi Technologies.
date: 2025-07-01
featured: true
draft: false
tags:
  - Python
  - Machine Learning
  - LLMs
  - Cloud Security
  - Data Loss Prevention
organization: ProMobi Technologies
role: Associate Product Engineer
startDate: 2025-07-01
location: Pune, India
organizationUrl: https://promobitech.com/
---

## Cloud Data Security Posture Management — Veltar

- Designed and implemented a three-layer sensitive-data detection architecture combining deterministic rules, named entity recognition models, and a self-hosted LLM. The system detects structured, semi-structured, and unstructured sensitive information with approximately 90% detection accuracy.
- Built rule-based detectors with regular expressions and identifier-specific validators, including checksum validation for structured payment and identity information.
- Integrated Stanford De-identifier and GLiNER biomedical NER models, alongside a self-hosted Qwen3.5 2B model served through vLLM for semantic detection of sensitive business information.
- Developed file-processing pipelines for Google Drive, Microsoft OneDrive, and Amazon S3. The pipelines support text, PDF, spreadsheet, presentation, document, and media formats through format-specific extraction and OCR.
- Engineered the platform to support at least 5 TB of data per customer, with current processing throughput of approximately 5 GB per hour.

## Secure Web Gateway — Veltar

- Co-developed an enterprise Secure Web Gateway used by approximately 100 customers across 6,000 managed devices, enabling administrators to enforce website-access policies on managed endpoints.
- Integrated and maintained open-source threat-intelligence feeds through scheduled ingestion jobs, creating a domain-intelligence dataset covering more than 60 million known domains.
- Developed a multi-stage website-categorization pipeline combining content scraping, keyword classification, machine-learning classification, and LLM-assisted categorization for ambiguous domains.
- Supported more than 45 website categories and contributed to a 75% reduction in customer-reported misclassification issues based on production monitoring.

## Secure Web Gateway DLP — Veltar

- Contributed to a managed-device Data Loss Prevention capability that prevents sensitive files from being uploaded to cloud services or transmitted through email according to administrator-defined security policies.
- Supported file-extension and regex-based controls for detecting and blocking sensitive data, including exposed AWS credentials, on devices managed through Scalefusion MDM.
