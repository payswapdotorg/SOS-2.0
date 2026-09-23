import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceRollbackVerifier,
  ReferenceWorld,
} from '@sos-2/action-gateway';
import type { Clock } from '@sos-2/action-gateway';
import { IndependentEvaluationService, defaultRegistry } from '@sos-2/evaluator';
import {
  EvaluationOrchestrator,
  RepairLoop,
  buildPlan,
  defaultApplicability,
  defaultSteps,
} from '@sos-2/evaluation-orchestration';
import type { AskPort, AskReceipt, RepairAsk, RepairExecutor } from '@sos-2/evaluation-orchestration';

export type ProviderStatusKind = 'REFERENCE' | 'NOT_YET_CONNECTED';

export interface ProviderStatus {
  readonly provider: string;
  readonly status: ProviderStatusKind;
  readonly detail: string;
}

export interface ActionsHost {
  readonly gateway: ActionGateway;
  readonly evaluation: IndependentEvaluationService;
  readonly orchestration: EvaluationOrchestrator;
  readonly repair: RepairLoop;
  readonly world: ReferenceWorld;
  readonly authority: InMemoryAuthority;
  readonly evidence: InMemoryEvidenceSink;
  readonly events: InMemoryEventLog;
  readonly asks: readonly RepairAsk[];
  onTick(): void;
  tickCount(): number;
  providerStatus(): readonly ProviderStatus[];
}

/**
 * Composition root: the single impure boundary of apps/actions. Everything —
 * clock, stores, executors, probes — is injected; the reference wiring below
 * is deterministic and offline. Real providers bind later as adapters behind
 * the executor/probe seams without contract change.
 */
export function buildHost(clock: Clock): ActionsHost {
  const world = new ReferenceWorld();
  const authority = new InMemoryAuthority();
  const executors = [new ReferenceExecutor(world)];
  const idempotency = new InMemoryIdempotencyStore();
  const events = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors,
    idempotency,
    events,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(world),
  });

  const evaluation = new IndependentEvaluationService(defaultRegistry(), clock);
  const orchestration = new EvaluationOrchestrator(evaluation, clock);
  const plan = buildPlan({
    steps: defaultSteps(),
    applicability: defaultApplicability(),
    maxRepairAttempts: 2,
  });

  const asks: RepairAsk[] = [];
  const askPort: AskPort = {
    submitAsk: (ask: RepairAsk): AskReceipt => {
      asks.push(ask);
      return { askId: ask.askId, accepted: true };
    },
  };
  const repairExecutor: RepairExecutor = {
    repair: () => ({ newSourceRevision: null, detail: 'NOT_YET_CONNECTED: no repair executor bound in reference mode' }),
  };
  const repair = new RepairLoop(orchestration, repairExecutor, askPort, null, clock);

  let ticks = 0;

  return {
    gateway,
    evaluation,
    orchestration,
    repair,
    world,
    authority,
    evidence,
    events,
    asks,
    onTick: () => {
      ticks += 1;
    },
    tickCount: () => ticks,
    providerStatus: () => [
      { provider: 'git-host (github adapter)', status: 'REFERENCE', detail: 'deterministic reference git executor; the real adapter attaches behind the seam' },
      { provider: 'deployment-target', status: 'NOT_YET_CONNECTED', detail: 'no real deployment evidence exists in reference mode' },
      { provider: 'security-scanner', status: 'NOT_YET_CONNECTED', detail: 'security probes are not connected and never fabricate findings' },
      { provider: 'browser-journeys', status: 'NOT_YET_CONNECTED', detail: 'no real browser evidence exists in reference mode' },
      { provider: 'mission-metrics', status: 'NOT_YET_CONNECTED', detail: 'no mission-metric evidence exists in reference mode' },
      { provider: 'reasoning-broker (advisory triage)', status: 'NOT_YET_CONNECTED', detail: 'advisory triage unbound; reasoning output would be non-authoritative regardless' },
    ],
  };
}
