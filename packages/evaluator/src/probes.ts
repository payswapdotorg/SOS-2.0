import type { EvaluationActorRef, EvaluationRequest, EvaluationType, ProbeObservation } from './types.js';

export interface EvaluatorProbe {
  readonly evaluatorId: string;
  readonly type: EvaluationType;
  /**
   * The body/actor this evaluator is bound to (null = independent). A bound
   * evaluator can never certify that actor's output — the service denies
   * such requests with EVALUATION_INDEPENDENCE_VIOLATION BEFORE the probe
   * runs.
   */
  readonly boundActor: EvaluationActorRef | null;
  readonly capability: 'REFERENCE' | 'NOT_YET_CONNECTED';
  run(request: EvaluationRequest): ProbeObservation;
}

export class EvaluatorRegistry {
  private readonly probes: EvaluatorProbe[] = [];

  register(probe: EvaluatorProbe): this {
    this.probes.push(probe);
    return this;
  }

  primaryFor(type: EvaluationType): EvaluatorProbe | null {
    return this.probes.find((probe) => probe.type === type) ?? null;
  }

  all(): readonly EvaluatorProbe[] {
    return [...this.probes];
  }
}
