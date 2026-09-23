import { contentAddress } from '@sos-2/action-gateway';
import { EvaluatorRegistry } from './probes.js';
import type { EvaluatorProbe } from './probes.js';
import type {
  EvaluationActorRef,
  EvaluationRequest,
  EvaluationType,
  ProbeObservation,
} from './types.js';
import { EVALUATION_TYPES } from './types.js';

interface ScriptedProbeOptions {
  readonly evaluatorId: string;
  readonly type: EvaluationType;
  readonly boundActor?: EvaluationActorRef | null;
  /** Scripted observations keyed by the target source revision. */
  readonly results?: ReadonlyMap<string, ProbeObservation>;
  readonly defaultObservation?: ProbeObservation;
}

/** Deterministic reference probe: scripted outcomes, else a passing default check. */
export class ScriptedReferenceProbe implements EvaluatorProbe {
  readonly evaluatorId: string;
  readonly type: EvaluationType;
  readonly boundActor: EvaluationActorRef | null;
  readonly capability = 'REFERENCE' as const;
  readonly observations: ProbeObservation[] = [];

  constructor(private readonly options: ScriptedProbeOptions) {
    this.evaluatorId = options.evaluatorId;
    this.type = options.type;
    this.boundActor = options.boundActor ?? null;
  }

  run(request: EvaluationRequest): ProbeObservation {
    const scripted = this.options.results?.get(request.target.sourceRevision) ?? null;
    const observation: ProbeObservation =
      scripted ??
      this.options.defaultObservation ?? {
        status: 'EVIDENCE_COLLECTED',
        limitations: [],
        evidence: {
          evidenceType: this.type,
          summary: `reference ${this.type} check passed`,
          checks: [
            {
              check: `${this.type}:deterministic`,
              passed: true,
              detail: 'deterministic reference probe',
              expected: null,
              actual: null,
            },
          ],
          artifactDigest: contentAddress({ type: this.type, target: request.target }, 'probe-artifact'),
        },
      };
    this.observations.push(observation);
    return observation;
  }
}

/**
 * Honest not-connected probe: there is NO real scanner / browser / deployment
 * verifier behind it, so it can never report evidence — and the service can
 * therefore never derive a PASS from it.
 */
export class NotYetConnectedProbe implements EvaluatorProbe {
  readonly evaluatorId: string;
  readonly type: EvaluationType;
  readonly boundActor: EvaluationActorRef | null = null;
  readonly capability = 'NOT_YET_CONNECTED' as const;

  constructor(evaluatorId: string, type: EvaluationType) {
    this.evaluatorId = evaluatorId;
    this.type = type;
  }

  run(request: EvaluationRequest): ProbeObservation {
    void request;
    return {
      status: 'NOT_YET_CONNECTED',
      limitations: [`${this.type}: real provider not connected (reference mode only)`],
    };
  }
}

const CONNECTED_REFERENCE_TYPES: readonly EvaluationType[] = ['tests', 'static-contract-checks'];

/** Default registry: deterministic reference probes for tests/static checks, honest NOT_YET_CONNECTED for the rest. */
export function defaultRegistry(): EvaluatorRegistry {
  const registry = new EvaluatorRegistry();
  for (const type of CONNECTED_REFERENCE_TYPES) {
    registry.register(new ScriptedReferenceProbe({ evaluatorId: `reference-${type}`, type }));
  }
  for (const type of EVALUATION_TYPES) {
    if (!CONNECTED_REFERENCE_TYPES.includes(type)) {
      registry.register(new NotYetConnectedProbe(`not-yet-connected-${type}`, type));
    }
  }
  return registry;
}
