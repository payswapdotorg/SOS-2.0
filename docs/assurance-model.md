# Assurance Model

SOS uses living assurance.

Assurance case:
Claims + Arguments + Assumptions + Hazards + Controls + Evidence + Validity conditions + Objections

Assurance can become invalid when:
- implementation changes
- dependencies change
- environment changes
- evidence expires
- runtime monitors detect anomalies
- assumptions are violated

Potential gates:
static analysis
architecture conformance
type/interface checks
tests
property tests
replay
simulation
fault injection
security/privacy checks
runtime verification
shadow
canary
controlled experiment

The trusted assurance mechanism must not be disabled by untrusted candidate code.

Every live change declares:
rollback mechanism, trigger, authority and evidence.

Promotion requires current authority + assurance + evidence + compatible current System State.
