/**
 * Interactive journey glue — the ONLY place the console accepts user input,
 * and it contains ZERO domain logic: form fields are mapped onto the domain
 * packages' own builders and the results are projected straight back
 * through @sos-2/ui-contracts. Failures from the domain validators are
 * surfaced truthfully (never swallowed, never coerced).
 */

import { createTraceLink } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { buildRationaleChain, projectMission } from '@sos-2/ui-contracts';
import type { MissionVM } from '@sos-2/ui-contracts';

export interface MissionFormInput {
  purpose: string;
  goal: string;
  measure_description: string;
  measure_target: string;
  constraint: string;
  provenance: string;
  created_at: string;
}

/**
 * Create a mission from the onboarding form (via @sos-2/mission's own
 * createMission — validation is the domain's). Returns either the projected
 * view-model or the domain's rejection message.
 */
export function createMissionFromForm(
  input: MissionFormInput,
  constitutionId: string,
): { vm: MissionVM; artifact: MissionArtifact } | { error: string } {
  let artifact: MissionArtifact;
  try {
    artifact = createMission({
      content: {
        purpose: input.purpose,
        goals: [
          {
            id: 'goal-console-onboarding',
            statement: input.goal,
            status: 'PROPOSED',
            measures: ['measure-console-onboarding'],
          },
        ],
        outcomes: [],
        stakeholders: [],
        measures: [
          {
            id: 'measure-console-onboarding',
            description: input.measure_description,
            target: input.measure_target === '' ? null : input.measure_target,
            unit: null,
          },
        ],
        assumptions: [],
        ambiguities: [],
        constraints:
          input.constraint === ''
            ? []
            : [{ id: 'constraint-console-onboarding', statement: input.constraint, hard: true, bound: null }],
      },
      provenance: [input.provenance],
      created_at: input.created_at,
      authority_ref: constitutionId,
      version: 1,
      status: 'DRAFT',
    });
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
  const originLink: TraceLink = createTraceLink({
    source: artifact.envelope.id,
    target: constitutionId,
    type: 'DERIVED_FROM',
    provenance: [input.provenance],
  });
  try {
    const vm = projectMission(artifact, buildRationaleChain({ subject_id: artifact.envelope.id, links: [originLink] }));
    return { vm, artifact };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}
