/**
 * @sos-2/experiments — SOS 2.0 Experiments (Work Order W9, parallel slot C).
 *
 * The controlled evolution plane: Experiment artifacts with
 * treatment/control or alternatives design, typed POPULATION and ALLOCATION
 * semantics, primary/secondary/GUARDRAIL metrics, stopping and rollback
 * criteria; the strict SHADOW -> CANARY -> CONTROLLED_EXPERIMENT lifecycle
 * with typed staged exposure; typed result records linked to the candidate
 * AND the causal hypothesis through VERIFIES/OBSERVES/CAUSED_BY trace
 * links; fail-closed guardrail evaluation and typed trigger records; and a
 * deterministic fixed-seed simulator whose outputs are marked simulated and
 * never presented as intervention evidence.
 *
 * PARALLELIZATION: this package consumes the MERGED W0.5/W2/W3/W6
 * authorities (@sos-2/semantic-spine, @sos-2/contracts via the spine,
 * @sos-2/architecture for the W2 LocalCandidate bridge, @sos-2/evidence for
 * the Confidence contract, @sos-2/provenance for Producer). It has NO
 * dependency on W7 (search — unmerged) or W8 (assurance — unmerged):
 * candidates are consumed through the CandidateState contract fixture.
 */

export * from './errors.js';
export * from './design.js';
export * from './lifecycle.js';
export * from './candidate-fixture.js';
export * from './artifact.js';
export * from './results.js';
export * from './evaluation.js';
export * from './simulator.js';
