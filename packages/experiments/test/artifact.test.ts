import { describe, expect, it } from 'vitest';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  candidateArmId,
  candidateStateFromLocalCandidate,
  controlArmId,
  createCandidateState,
  createExperiment,
  experimentTraceLinks,
  experimentArtifactId,
  isLlmDrafted,
  validateCandidateState,
  validateExperiment,
  CANDIDATE_STATE_KIND,
} from '../src/index.js';
import {
  candidateInput,
  createExperimentArtifact,
  llmProducer,
  sampleCandidate,
  sampleCandidateContent,
  sampleExperimentInput,
  sampleLocalCandidate,
  HYPOTHESIS_ID,
  PROVENANCE,
  T0,
} from './helpers.js';

describe('CandidateState fixture (frozen-kind contract shape)', () => {
  it('mints a spine envelope of the frozen core kind CandidateState', () => {
    const candidate = sampleCandidate();
    expect(candidate.envelope.kind).toBe(CANDIDATE_STATE_KIND);
    expect(candidate.envelope.id).toMatch(/^sos:\/\/CandidateState\/[0-9a-f]{32}$/);
    expect(validateCandidateState(candidate)).toBe(true);
  });

  it('derives deterministic, content-addressed ids', () => {
    const a = sampleCandidate();
    const b = sampleCandidate();
    expect(a.envelope.id).toBe(b.envelope.id);
    const different = createCandidateState({
      ...candidateInput(sampleCandidateContent()),
      status: 'ACTIVE',
    });
    expect(different.envelope.id).not.toBe(a.envelope.id);
  });

  it('requires invariants (a candidate without preserved invariants is rejected)', () => {
    const content = sampleCandidateContent();
    content.invariants = [];
    expect(() => createCandidateState(candidateInput(content))).toThrow(/non-empty array/);
  });

  it('requires causal candidates to declare predicted effects (testability)', () => {
    const content = sampleCandidateContent();
    content.predicted_effects = [];
    expect(() => createCandidateState(candidateInput(content))).toThrow(/causal candidate must declare/);
  });

  it('requires hypothesis refs to reference CausalHypothesis artifacts (typed link)', () => {
    const content = sampleCandidateContent();
    content.hypothesis_ref = deriveDeterministicArtifactId('Mission', { note: 'w9 hypothesis probe' });
    expect(() => createCandidateState(candidateInput(content))).toThrow(/CausalHypothesis/);
  });

  it('adapts a merged W2 LocalCandidate through the compatibility bridge', () => {
    const local = sampleLocalCandidate();
    const candidate = candidateStateFromLocalCandidate(local, {
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(validateCandidateState(candidate)).toBe(true);
    expect(candidate.content.invariants).toEqual(local.invariants);
    expect(candidate.content.predicted_effects).toEqual(local.predictedEffects);
    expect(candidate.content.bounded_subgraph_ref).toEqual({
      graph_id: local.baseGraphRef.graph_id,
      version: local.baseGraphRef.version,
    });
    expect(candidate.content.hypothesis_ref).toBeNull();
    expect(candidate.content.causal_claim).toBe(true);
  });
});

describe('experiment artifacts', () => {
  it('mints spine envelopes of the frozen core kind Experiment with deterministic ids', () => {
    const experiment = createExperimentArtifact();
    expect(experiment.envelope.kind).toBe('Experiment');
    expect(experiment.envelope.id).toMatch(/^sos:\/\/Experiment\/[0-9a-f]{32}$/);
    expect(validateExperiment(experiment)).toBe(true);
    expect(createExperimentArtifact().envelope.id).toBe(experiment.envelope.id);
    expect(experimentArtifactId(sampleExperimentInput(), sampleExperimentInput().content)).toBe(
      experiment.envelope.id,
    );
  });

  it('links the candidate under test and requires it to be exposed by an arm', () => {
    const experiment = createExperimentArtifact();
    expect(experiment.content.candidate_ref).toMatch(/^sos:\/\/CandidateState\//);
    expect(candidateArmId(experiment)).toBe('treatment');
    expect(controlArmId(experiment)).toBe('control');
  });

  it('requires the hypothesis link to reference a CausalHypothesis artifact', () => {
    const input = sampleExperimentInput();
    input.content.hypothesis_ref = deriveDeterministicArtifactId('Evidence', { note: 'w9 hypothesis probe' });
    expect(() => createExperiment(input)).toThrow(/CausalHypothesis/);
  });

  it('requires the candidate under test to be exposed by a design arm', () => {
    const input = sampleExperimentInput();
    input.content.candidate_ref = deriveDeterministicArtifactId('CandidateState', {
      note: 'w9 unexposed candidate probe',
    });
    expect(() => createExperiment(input)).toThrow(/not exposed by any arm/);
  });

  it('produces VERIFIES (candidate) and DERIVED_FROM (hypothesis) trace links', () => {
    const experiment = createExperimentArtifact();
    const links = experimentTraceLinks(experiment);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      source: experiment.envelope.id,
      target: experiment.content.candidate_ref,
      type: 'VERIFIES',
    });
    expect(links[1]).toMatchObject({
      source: experiment.envelope.id,
      target: HYPOTHESIS_ID,
      type: 'DERIVED_FROM',
    });
    for (const link of links) {
      expect(link.provenance).toBeDefined();
      expect(link.provenance!.length).toBeGreaterThan(0);
    }
  });

  it('marks LLM-drafted experiments (never authoritative)', () => {
    const input = sampleExperimentInput();
    input.content.producer = llmProducer();
    const experiment = createExperiment(input);
    expect(isLlmDrafted(experiment)).toBe(true);
    expect(validateExperiment(experiment)).toBe(true);
  });

  it('freezes deep copies at creation (mutating the input never mutates the artifact)', () => {
    const input = sampleExperimentInput();
    const experiment = createExperiment(input);
    input.content.design.population.description = 'mutated';
    expect(experiment.content.design.population.description).not.toBe('mutated');
  });
});
