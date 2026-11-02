Fixed
- Small code changes now use exact anchored edits; ordinary file writes cannot overwrite an existing file, and deliberate whole-file replacements require current-file confirmation and support undo.
- Markdown and PDF windows open with less startup work, and streaming conversations do less rendering while staying smooth.
