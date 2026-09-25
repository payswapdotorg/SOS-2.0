/**
 * THE REFERENCE MISSION FORMALIZER (Work Order P13) — the deterministic,
 * offline stand-in behind the MissionFormalizerPort seam.
 *
 * Rules (typed, deterministic, documented):
 *
 *   - an EMPTY (or whitespace-only) mission statement cannot be
 *     formalized -> typed ASK (EMPTY_MISSION). The pipeline never invents
 *     a purpose.
 *   - a statement carrying an UNRESOLVED question marker ('?') is an
 *     irrevocable ambiguity at reference fidelity -> typed ASK
 *     (IRRESOLVABLE_AMBIGUITY) carrying the open questions verbatim.
 *   - otherwise the statement formalizes deterministically: purpose =
 *     the trimmed statement, one delivery goal, one repository-delivery
 *     constraint (the greenfield journey lands in the connected repo),
 *     and an honest record of what the reference formalizer did NOT
 *     derive (an explicit assumption, retained as mission uncertainty
 *     provenance).
 *
 * The formalizer mints the MissionArtifact through the merged
 * @sos-2/mission model (createMission — the spine owns identity); it
 * never mints authority and its output is re-validated by the intake.
 */

import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { mintPipelineAsk } from '../asks.js';
import type { MissionFormalizationResult, MissionFormalizerPort, RawUserMission } from '../intake.js';

/** Options: the creation instant is caller-supplied (no hidden clocks). */
export interface ReferenceMissionFormalizerOptions {
  /** RFC3339 formalization instant (caller-supplied). */
  readonly createdAt: string;
  /** Provenance entries stamped on the minted mission. */
  readonly provenance?: readonly string[];
}

export class ReferenceMissionFormalizer implements MissionFormalizerPort {
  private readonly options: ReferenceMissionFormalizerOptions;

  constructor(options: ReferenceMissionFormalizerOptions) {
    if (typeof options !== 'object' || options === null || typeof options.createdAt !== 'string' || options.createdAt.length === 0) {
      throw new TypeError('ReferenceMissionFormalizer requires a caller-supplied createdAt RFC3339 instant (no hidden clocks)');
    }
    this.options = options;
  }

  formalize(raw: RawUserMission): MissionFormalizationResult {
    const statement = raw.statement.trim();
    if (statement.length === 0) {
      return {
        kind: 'ASK',
        ask: mintPipelineAsk({
          stage: 'FORMALIZATION',
          reasonCode: 'EMPTY_MISSION',
          detail: 'the mission statement is empty — SOS cannot formalize a mission without a purpose, and it never invents one',
          openQuestions: ['What should this mission accomplish?'],
          context: { statement: raw.statement, repositorySlug: raw.repositorySlug, source: raw.source },
          createdAt: this.options.createdAt,
        }),
      };
    }
    if (statement.includes('?')) {
      const openQuestions = statement
        .split(/[.;]/)
        .map((fragment) => fragment.trim())
        .filter((fragment) => fragment.includes('?'))
        .map((fragment) => (fragment.startsWith('?') ? fragment : `?${fragment}`));
      return {
        kind: 'ASK',
        ask: mintPipelineAsk({
          stage: 'FORMALIZATION',
          reasonCode: 'IRRESOLVABLE_AMBIGUITY',
          detail:
            'the mission statement carries unresolved questions — the reference formalizer cannot resolve ambiguity, and a formalized mission must state its purpose without open questions',
          openQuestions: openQuestions.length > 0 ? openQuestions : [statement],
          context: { statement: raw.statement, repositorySlug: raw.repositorySlug, source: raw.source },
          createdAt: this.options.createdAt,
        }),
      };
    }
    const mission: MissionArtifact = createMission({
      content: {
        purpose: statement,
        goals: [{ id: 'goal-deliver', statement: `Deliver: ${statement}`, status: 'PROPOSED', measures: [] }],
        outcomes: [{ id: 'outcome-repository', description: 'The implemented system is delivered inside the connected GitHub repository.', goal_refs: ['goal-deliver'] }],
        stakeholders: [],
        measures: [],
        assumptions: [
          {
            id: 'assumption-reference-formalizer',
            statement:
              'The reference formalizer derived the delivery goal deterministically from the mission statement; a connected reasoning provider may refine it later (non-authoritative).',
          },
        ],
        ambiguities: [],
        constraints: [
          {
            id: 'constraint-repository-delivery',
            statement: 'The implemented system must land in the connected GitHub repository as branches, commits and a pull request.',
            hard: true,
            bound: null,
          },
        ],
      },
      provenance: [...(this.options.provenance ?? ['p13-reference-formalizer']), `raw-mission:${raw.source}`],
      created_at: this.options.createdAt,
      status: 'ACTIVE',
    });
    return { kind: 'FORMALIZED', mission, ambiguitiesResolved: [] };
  }
}
