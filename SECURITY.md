# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | Best effort |

## Reporting a vulnerability

Please open a private security advisory or email the maintainers via the repository security contact. Do not file public issues for exploitable flaws that could harm user workspaces (e.g. path escapes, shell bypasses).

## Hardening notes

- Workspace trust: untrusted workspaces are not supported.
- Edits are confined to workspace roots (realpath / symlink-aware).
- Shell commands are risk-classified; destructive patterns are blocked; medium/high risk always require confirmation.
- API keys live in Secret Storage.
