---
title: pdf-2-json-extractor
summary: Converts PDFs into layout-aware JSON while preserving heading hierarchy, multi-column reading order, Unicode, and optional OCR. Its documented 50-page benchmark runs in approximately 5–10 seconds on a modern CPU.
date: 2026-08-24
featured: true
draft: false
tags:
  - Python
  - PyMuPDF
  - Layout Aware
organization: PyPI
repositoryUrl: https://github.com/Rushi-Balapure/pdf_2_json_extractor
packageUrl: https://pypi.org/project/pdf-2-json-extractor/
contributionSummary: Created and maintain the package, extraction architecture, Python API, CLI, tests, and releases.
impact: Published as a production-stable Python package with layout-aware, multilingual, CPU-only extraction.
---

`pdf-2-json-extractor` preserves document structure that is commonly lost when a PDF is reduced to plain text. It identifies headings from H1 through H6, assembles body paragraphs in reading order, and emits clean JSON for document-analysis and language-model workflows.

## Why it exists

PDF text extraction often returns disconnected blocks with little indication of hierarchy or reading order. This package uses font size, style, spatial relationships, and a layout-reconstruction approach inspired by published research to retain more of that context.

## Capabilities

- Detects heading levels and body content through font and style analysis.
- Reconstructs visual multi-column reading order and optionally preserves source-page references.
- Preserves Unicode text and supports configurable Tesseract languages for scanned pages.
- Runs locally on CPUs without heavy machine-learning models or an internet connection.
- Provides both a Python API and a command-line interface for individual and batch PDF processing.
- Handles batch failures independently and protects against output-name collisions.

## Performance and distribution

The package uses PyMuPDF and streaming assembly to limit intermediate extraction overhead. Its documented benchmark processes a typical 50-page PDF in approximately 5 to 10 seconds on a modern CPU.

Version 1.4.0 supports Python 3.10 and newer and is distributed through PyPI under the Apache 2.0 license.

```bash
pip install pdf_2_json_extractor
pdf_2_json_extractor document.pdf -o output.json
```
