# Reference Implementation Stack

The reference stack is a replaceable realization, not semantic authority.

Primary reference:
- TypeScript/Node.js control plane
- PostgreSQL-compatible durable store
- OpenTelemetry-compatible ingestion
- JSON Schema contracts
- Web console
- optional specialized Python/Rust engines behind stable contracts

Rules:
- semantic types are framework independent
- storage is adapter based
- LLM providers implement a reasoning-provider contract
- search/optimization engines implement candidate-search contracts
- telemetry backends implement evidence-ingestion contracts
- runtime/package adapters implement stable package contracts

A technology replacement must preserve the Semantic Spine and public contract semantics.
