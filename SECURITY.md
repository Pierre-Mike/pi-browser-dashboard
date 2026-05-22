# Security policy

## Reporting a vulnerability

If you find a security issue, **do not open a public issue**. Instead, use
GitHub's private vulnerability reporting:

> [Report a vulnerability](https://github.com/Pierre-Mike/pi-browser-dashboard/security/advisories/new)

Include:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- Affected commit / version.

You should receive an acknowledgment within a few days. Fixes will be
coordinated through a private advisory before public disclosure.

## Scope

This project is a local-first dashboard. It does not, by default, expose
the daemon outside `localhost`. Issues in scope include:

- Path-traversal or arbitrary-file-read in the daemon HTTP surface.
- Command injection via dispatch / shell-out paths.
- XSS or HTML injection in the transcript / file-viewer renderers.
- Authentication / authorization gaps if the dashboard is bound to a
  non-loopback interface.

Out of scope:

- Social-engineering, physical access, or compromised host scenarios.
- Issues in third-party dependencies — please report upstream first; we'll
  bump versions once a patched release ships.

## Supported versions

This project is pre-1.0. Only `main` is supported.
