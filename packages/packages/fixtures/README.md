# Golden Contract Fixtures (W6 packages)

Canonical baseline instances of the W6 package model. Tests reproduce them
bit-exactly through the public API; downstream Work Orders consume these
fixtures — or mint new ids via `@sos-2/semantic-spine` — so that no
downstream worker ever invents core identifiers.

| Fixture | Model |
| --- | --- |
| `package-artifact.json` | `PackageArtifact` — the W0.5 golden package record realized as a full W6 artifact (explicit id `sos://Package/7f8e6f3257bd8625b2082cb4476a1d6b`; `toPackageRecord` reproduces `packages/semantic-spine/fixtures/package-record.json` bit-exactly) |
| `durable-store-package.json` | `PackageArtifact` — the companion DISCOVERED package (deterministic id), a composition member and registry test subject |

Identifier discipline: the golden package uses the W0.5 golden id
(explicit-id mode — consuming the golden fixture, never inventing); the
companion package id is content-addressed and reproduced by
`createPackageArtifact` bit-exactly. `regenerate via
`node scripts/gen-golden-package.mjs` (the reproduction tests pin
equality).

Sample-data notice: the fixtures cite the W0.5 golden evidence record and
implementation model as realistic sample data (contract test data, not
evidence claims about any system).
