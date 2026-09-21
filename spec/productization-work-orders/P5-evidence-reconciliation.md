# P5 — Harness Protocol + Body Broker + Execution Fabric

Dependencies: P2, P3  
Owned paths: packages/harness, packages/body-broker, packages/execution-fabric, packages/runtime-contracts, tests/harness-contracts  
Worker: B in wave 2

## Goal

Create the provider-neutral execution layer that lets SOS possess interchangeable bodies.

## Scope

- Harness Contract
- capability advertisement
- body identity
- body leases
- create/resume/pause/cancel
- workspace and shell operations
- browser operations where available
- git operations
- artifact capture
- observation/event emission
- body health and release
- capability-based body selection

Integration priority:

1. native API/SDK/app-server
2. MCP/equivalent protocol
3. local companion/service bridge
4. browser/IDE extension
5. UI automation last

## Acceptance

- a fake/reference body can execute a complete bounded task through the contract
- capabilities are explicit and provider-neutral
- body lease expiry/revocation fails closed
- body cannot mint authority
- provider/vendor identity never becomes SOS semantic identity
- body replacement preserves task identity
