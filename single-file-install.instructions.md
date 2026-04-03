# single-file-install instruction

## Purpose
Ensure plugin installation stays simple and robust for OpenCode by requiring a single entrypoint file in the plugin folder.

## Rule
- The OpenCode plugin must be installable by copying exactly one file into the plugin directory.
- Do not create or require multiple plugin files for the core feature.
- The user should be able to follow the install guide by copying `force-continue.server.js` into either `~/.config/opencode/plugins` (global) or `.opencode/plugins` (project-level).

## Why
- Keeps install/uninstall atomic and low friction.
- Avoids state/config synchronization issues across multiple files in different folders.
- Matches README examples and the user request.

## Applies to
- `force-continue.server.js` plugin code
- install/uninstall scripts and documentation

## Example prompt
- "Implement the plugin as a single file so end users can install by copying one file into `~/.config/opencode/plugins`."