# Changelog

## 0.2.0-preview.1 - 2026-07-19 - Reviewed Editing Preview

- Added **Edit with AI** to Overleaf's native text-selection toolbar.
- Added project file discovery and source-comment tools so the assistant can inspect files beyond the active document.
- Added line-addressed patch operations for reliable insertions, replacements, and repeated comment edits.
- Added inline CodeMirror diff previews with per-hunk Undo and Keep controls.
- Added direct-edit and Track Changes application modes through Overleaf's editor and OT lifecycle.
- Persisted applied hunk state so chat review remains synchronized after approval and conversation reloads.
- Improved multi-file validation, stale proposal handling, patch auditing, and applied-hunk accounting.
- Enabled native Overleaf editor tabs for the derivative deployment.
- Polished the AI rail, proposal cards, buttons, activity display, conversation selector, and local delete confirmation.
- Fixed the CE+ extension loader integration for selection-toolbar actions.

## 0.1.1 - 2026-07-19 - ChatMock provider support

- Added a server-only configurable Responses-compatible provider base URL.
- Added a generic provider credential with backwards-compatible OpenAI key fallback.
- Added fail-closed URL validation and provider-aware disclosure text.
- Documented ChatMock deployment and the local-proxy versus local-inference boundary.

## 0.1.0-phase1 - 2026-07-19

- Add project-scoped streaming AI conversations with local persistence.
- Add constrained project read/search and reviewed patch-proposal tools.
- Add stale-hash validation and CodeMirror/OT patch application.
- Add compiler-error action, sanitized Markdown, cancellation, quotas, allowlisting, usage accounting, and admin APIs.
- Add a pinned derivative image build for CE+ `6.2.0-ext-v5.0` at revision `c7579e3e74b0b23c3cfd969b0b90ef1daf0a6b55`.
