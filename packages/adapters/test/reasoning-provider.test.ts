/**
 * ReasoningProviderAdapter tests — model provenance, JSON bridge outputs
 * and the NON-AUTHORITATIVE discipline (spec/architecture.md section 18:
 * LLM output is never authoritative evidence or authorization).
 */

import { describe, expect, it } from 'vitest';
import { assertValidEvidenceRecord, isNonAuthoritativeEvidence } from '@sos-2/evidence';
import {
  InMemoryReasoningProviderAdapter,
  REASONING_COMPLETION_OUTPUT,
  SemanticBridgeError,
  assertNonAuthoritativeEvidence,
  reasoningOutputAsEvidence,
  reasoningProducer,
  verifyAdapterOutputs,
} from '../src/index.js';
import { SUBJECT_ID, T0, T1, toolProducer } from './helpers.js';

const MODEL = { model: 'glm-4.6', model_version: '2025-06' };

describe('InMemoryReasoningProviderAdapter', () => {
  it('completes requests with model id + version provenance on every output', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, (request) => ({
      echo: request.prompt,
      system: request.system,
    }));
    const output = provider.complete({ system: 'be terse', prompt: 'summarize the mission', inputs: null });
    expect(output.content).toEqual({ echo: 'summarize the mission', system: 'be terse' });
    expect(output.producer.model).toBe('glm-4.6');
    expect(output.producer.model_version).toBe('2025-06');
    expect(provider.model).toEqual(MODEL);
  });

  it('always produces LLM-marked producers (the non-authoritative mark cannot be evaded)', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => null);
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    expect(output.producer.model).not.toBeNull();
  });

  it('rejects malformed model identities and handlers at construction', () => {
    expect(() => new InMemoryReasoningProviderAdapter({ model: '', model_version: '1' }, () => null)).toThrow();
    expect(
      () => new InMemoryReasoningProviderAdapter({ model: 'm' } as unknown as { model: string; model_version: string }, () => null),
    ).toThrow();
    expect(() => new InMemoryReasoningProviderAdapter(MODEL, 'not-a-function' as unknown as () => null)).toThrow();
  });

  it('rejects malformed completion requests', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => null);
    expect(() => provider.complete({ system: null, prompt: '', inputs: null })).toThrow();
    expect(() =>
      provider.complete({ system: null, prompt: 'p', inputs: { bad: () => 1 } } as never),
    ).toThrow();
  });

  it('rejects non-JSON handler payloads (outputs are JSON bridges)', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => ({ fn: () => 1 } as never));
    expect(() => provider.complete({ system: null, prompt: 'p', inputs: null })).toThrow(/non-JSON/);
  });

  it('builds LLM-marked producers for a model identity', () => {
    const producer = reasoningProducer(MODEL, 'ci:test');
    expect(producer.model).toBe('glm-4.6');
    expect(producer.environment).toBe('ci:test');
    expect(() => reasoningProducer({ model: '', model_version: '' })).toThrow();
  });
});

describe('reasoningOutputAsEvidence (the non-authoritative bridge)', () => {
  it('mints evidence whose llm_output is EXACTLY true, narrowed at the type level', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => ({ answer: 42 }));
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    const record = reasoningOutputAsEvidence({
      output,
      subject: SUBJECT_ID,
      window: { start: T0, end: T1 },
    });
    // The type is NonAuthoritativeEvidence (llm_output: true) — runtime pin:
    expect(record.llm_output).toBe(true);
    expect(isNonAuthoritativeEvidence(record)).toBe(true);
    expect(record.producer.model).toBe('glm-4.6');
    expect(record.provenance).toContain('model:glm-4.6');
    expect(() => assertValidEvidenceRecord(record)).not.toThrow();
  });

  it('REJECTS outputs whose producer is not LLM-marked (mark evasion)', () => {
    const forged = {
      content: { answer: 42 },
      producer: toolProducer(), // model === null — NOT an LLM producer
    };
    expect(() =>
      reasoningOutputAsEvidence({ output: forged as never, subject: SUBJECT_ID }),
    ).toThrow(/LLM-marked/);
  });

  it('REJECTS malformed subjects (evidence is only minted about spine subjects)', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => null);
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    expect(() => reasoningOutputAsEvidence({ output, subject: 'not-a-spine-id' })).toThrow();
  });
});

describe('assertNonAuthoritativeEvidence (negative: LLM output as authoritative evidence REJECTED)', () => {
  it('accepts genuinely non-authoritative records', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => 1);
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    const record = reasoningOutputAsEvidence({ output, subject: SUBJECT_ID });
    expect(() => assertNonAuthoritativeEvidence(record)).not.toThrow();
  });

  it('REJECTS records tampered toward authority (llm_output: false)', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => 1);
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    const record = reasoningOutputAsEvidence({ output, subject: SUBJECT_ID });
    const tampered = { ...record, llm_output: false };
    // The W3 layer itself rejects the inconsistency (derived from producer).
    expect(() => assertValidEvidenceRecord(tampered)).toThrow(/llm_output/);
    expect(() => assertNonAuthoritativeEvidence(tampered as never)).toThrow(/never authoritative/);
  });

  it('REJECTS non-LLM records passed off as reasoning evidence (they are a different thing)', () => {
    // A tool-produced record has llm_output: false; the reasoning bridge
    // must refuse to certify it as NON-authoritative reasoning evidence...
    // and more importantly, tool output is not LLM output at all. The
    // bridge only certifies its own kind.
    expect(() => assertNonAuthoritativeEvidence({ llm_output: false } as never)).toThrow(
      /never authoritative/,
    );
  });
});

describe('semantic bridge over reasoning outputs', () => {
  it('verifies completions as { content: JsonValue, producer: Producer } bridges', () => {
    const provider = new InMemoryReasoningProviderAdapter(MODEL, () => ({ ok: true }));
    const output = provider.complete({ system: null, prompt: 'p', inputs: null });
    expect(() => verifyAdapterOutputs(REASONING_COMPLETION_OUTPUT, output)).not.toThrow();
    // A forged output with a non-Producer fails the bridge guard.
    expect(() => verifyAdapterOutputs(REASONING_COMPLETION_OUTPUT, { content: null, producer: {} })).toThrow(
      SemanticBridgeError,
    );
    // The full contract descriptor requires the evidence site too.
    expect(() => verifyAdapterOutputs(provider.descriptor, output)).toThrow(SemanticBridgeError);
  });
});
