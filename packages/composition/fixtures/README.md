# Golden Contract Fixtures (W6 composition)

| Fixture | Model |
| --- | --- |
| `package-composition.json` | `PackageCompositionArtifact` — the FORMING golden composition (deterministic id `sos://PackageComposition/2030ae1a8921c2f8dc3d73dc562a17b7`) composing the W6 golden package (spine role) and the durable-store companion (store role) through one PROVIDES_TO binding |

Identifier discipline: the composition id is content-addressed over the
creation address and reproduced bit-exactly by `createPackageComposition`
(pinned by the reproduction test). Members reference the W6 package
fixtures' ids (never invented). The composition carries NO evidence yet —
own evidence arrives through the form-then-promote flow (evidence about the
chain), exactly as the own-evidence discipline prescribes.

Regenerate via `node scripts/gen-golden-composition.mjs`.
