/**
 * Shared test fixtures for @sos-2/provenance tests.
 *
 * Anchor ids are CONSUMED from the W0.5 golden contract fixtures
 * (packages/semantic-spine/fixtures) — downstream workers never invent core
 * identifiers (W0.5 export discipline).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mintRandomArtifactId } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

/** ImplementationModel anchor id from the W0.5 golden fixture implementation-model.json. */
export const IMPLEMENTATION_MODEL_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/implementation-model.json'), 'utf8')) as {
    id: string;
  }
).id;

export const PROVENANCE = ['W3:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const BASE_SHA = '219cb9c8e329b0435f2deea37ec2d5003b264931';

export const W0: { start: string; end: string } = { start: T0, end: T1 };
export const W1: { start: string; end: string } = { start: T1, end: T2 };

export function sampleProducer(): {
  tool: string;
  tool_version: string | null;
  model: string | null;
  model_version: string | null;
  command: string | null;
  environment: string | null;
} {
  return {
    tool: 'vitest',
    tool_version: '3.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:github-actions:ubuntu-24.04',
  };
}

export function sampleLlmProducer(): {
  tool: string;
  tool_version: string | null;
  model: string;
  model_version: string | null;
  command: string | null;
  environment: string | null;
} {
  return {
    tool: 'z-ai-llm',
    tool_version: null,
    model: 'glm-4.6',
    model_version: '2025-09',
    command: null,
    environment: 'sandbox',
  };
}

export function randomArtifactIdOfKind(kind: string): string {
  return mintRandomArtifactId(kind);
}

/** A fresh chain referencing a random artifact id (unique per call). */
export function sampleChain(): { ref: string; ref_kind: 'ARTIFACT'; note: string | null }[] {
  return [{ ref: mintRandomArtifactId('Evidence'), ref_kind: 'ARTIFACT', note: 'derived from evidence' }];
}
