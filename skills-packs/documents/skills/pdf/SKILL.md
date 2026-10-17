---
name: pdf
description: Turn a document into a branded PDF — the press (the Nimbus system). Markdown, notes, a charter, a report → one press/press_document call with the full markdown and a brand kit (e.g. the company's short id). Use whenever the operator asks for a PDF, a printable or branded document, "export", or Nimbus.
category: documents
version: 0.1.0
metadata:
  format: neuma-native
---

# PDF — the press

The operator asked for a PDF. That is one tool call, not a research project.

1. **Get the markdown.** A file: read it with `fs/read` — the whole file (if
   the read says it continues, read on; the press needs every line). Text the
   operator gave you: use it as written.
2. **Press it.** Call `press/press_document` (the first time in a chat, reach
   it by its exact name: `system/tool_search` with `press/press_document`):

   ```json
   {"markdown": "<the full markdown>", "title": "<the document's title>", "kit": "<kit id>"}
   ```

   - `kit` is the brand the operator named, by its id (Ignis AI Labs →
     `ignis`). Not sure? Call it anyway — an unknown id answers with the real
     list; pick from it and press again. Omit `kit` for the neutral look.
   - The press understands ```` ```chartjs ```` and ```` ```pagebreak ````
     fences, `::: summary|feature|warning|note` boxes, and `@icon` tags.
3. **Report the saved path exactly as the result gives it** (your workspace,
   `tool-results/pressed/`). The operator can right-click it to open or show it.

Do not: rewrite or summarize the document unless asked; press a shortened
copy; guess a path or claim a PDF exists before the result says so. The
first pressing may wait on the operator's approval — that is the gate working.
