# P4 — Mission + Repository Onboarding

Dependencies: P1, P2  
Owned paths: apps/web onboarding routes/components, packages/web-contracts onboarding, packages/github  
Worker: A in wave 2

## Goal

Make the first user journey mission-first and connect real project repositories.

## Greenfield

purpose -> outcomes -> stakeholders -> measures -> constraints -> review -> authority confirmation -> GitHub connection.

## Brownfield

GitHub repository/runtime import -> evidence scan -> competing architecture hypotheses -> confirmation.

JSON/raw import remains an advanced mode.

## GitHub capabilities

- OAuth/GitHub App connection with least-privilege repository scope
- repository discovery
- branch/revision selection
- empty-repository detection
- snapshot/metadata import
- webhook registration where supported
- PR/commit operations exposed through a provider-neutral project adapter

## Acceptance

A new user can connect an empty or existing GitHub repository without knowing SOS artifact names, and the repository identity/revision is linked into System State.
