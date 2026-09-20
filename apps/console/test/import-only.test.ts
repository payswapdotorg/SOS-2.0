/**
 * The import-only check — the W11 negative discipline: "app redefining
 * domain types REJECTED".
 *
 * The console app (@sos-2/console) must contain ZERO domain logic of its
 * own: every domain type/vocabulary is IMPORTED from @sos-2/* packages.
 * This test statically enforces it:
 *
 *   1. NO import specifier outside @sos-2/*, node:* builtins and relative
 *      app modules (no third-party domain logic smuggled in);
 *   2. NO local type/interface/enum declaration shadowing the frozen domain
 *      vocabulary (the console never redefines what the workspace packages
 *      own);
 *   3. the domain packages really are the import surface (the app imports
 *      them, not vendored copies).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'src');

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTypeScriptFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * The frozen domain vocabulary owned by the workspace packages (compiled
 * from their public surfaces — the spine contracts, the W1-W10 domain
 * types and the W11 view-model contracts). The console may IMPORT these
 * names; it may never DECLARE them.
 */
const FROZEN_DOMAIN_TYPE_NAMES: readonly string[] = [
  // spine / contracts (W0.5)
  'ArtifactEnvelope', 'ArtifactStatus', 'ArtifactKind', 'CoreArtifactKind', 'KindRegistry',
  'TraceLink', 'TraceLinkType', 'EvidenceTruthState', 'EvidenceRecord', 'ConformanceClass',
  'ConformanceFinding', 'ClassificationConfig', 'ImplementationModel', 'ImplementationComponent',
  'SourceArtifact', 'InterfaceDeclaration', 'ImplementationDependency', 'TestRef', 'BuildRef',
  'DeploymentRef', 'RuntimeMapping', 'PackageRecord', 'PackageMaturity', 'ArchitectureDelta',
  'ParsedArtifactId', 'RegistryEntry', 'CreateEnvelopeInput', 'CreateTraceLinkInput',
  // mission (W1)
  'MissionArtifact', 'MissionContent', 'MissionGoal', 'MissionMeasure', 'MissionOutcome',
  'MissionStakeholder', 'MissionAssumption', 'MissionAmbiguity', 'MissionConstraint',
  'MissionBound', 'MissionGoalStatus', 'MissionCreationAddress', 'MissionStore', 'ReviseMissionInput',
  // system state + architecture + conformance (W2)
  'SystemStateArtifact', 'SystemStateContent', 'ArchitectureReference', 'SystemStateRevisionRef',
  'ImplementationReference', 'ConfigurationReference', 'DeploymentReference', 'PolicyReference',
  'EnvironmentRelationship', 'ActiveExperimentReference', 'PackageRealizationReference',
  'SystemStateStore', 'ArchitectureGraphArtifact', 'ArchitectureGraphContent', 'GraphNode',
  'GraphEdge', 'EdgeKey', 'NodeCriticality', 'LocalCandidate', 'BoundedSubgraph',
  'EvolutionOperation', 'GraphDiff', 'ReconciliationRecord', 'ReconciliationResult',
  'DriftEvidenceRecord', 'DriftClassification', 'ReconciliationConfig',
  // evidence + provenance (W3)
  'EvidenceRecordW3', 'EvidenceClass', 'Confidence', 'CalibratedConfidence',
  'QualitativeConfidence', 'FreshnessStatus', 'FreshnessEvaluation', 'EvidenceGraph',
  'Producer', 'TimeWindow', 'ProvenanceRecord', 'ProvenanceHop',
  // assurance (W8)
  'AssuranceCaseArtifact', 'AssuranceCaseContent', 'AssuranceClaim', 'AssuranceArgument',
  'AssuranceAssumption', 'AssuranceHazard', 'AssuranceControl', 'EvidenceRef',
  'EvidenceRefRole', 'ValidityCondition', 'Objection', 'ObjectionResolution', 'ObjectionStatus',
  'AssuranceEvaluation', 'AssuranceEvaluationInput', 'AssuranceInvalidation', 'AssuranceVerdict',
  'InvalidationReason',
  // experiments (W9)
  'ExperimentArtifact', 'ExperimentContent', 'ExperimentDesign', 'ExperimentDesignKind',
  'ExperimentMetric', 'MetricRole', 'MetricDirection', 'Population', 'Allocation', 'Arm',
  'ArmRole', 'AllocationUnit', 'AssignmentMode', 'StoppingCriterion', 'RollbackCriterion',
  'StageExposure', 'ExperimentPhase', 'ExperimentResultRecord', 'MetricOutcome',
  'SimulatorProvenance', 'ExperimentEvaluation', 'GuardrailEvaluation', 'GuardrailStatus',
  'MetricEvaluation', 'TriggerRecord', 'TriggerKind', 'ConditionCheck',
  'CandidateStateFixture', 'CandidateStateContent', 'CandidateStateCreationAddress',
  // promotion (W9)
  'PromotionEvaluation', 'PromotionDecisionArtifact', 'PromotionDecisionContent',
  'BoundedRecoveryDeclaration', 'RollbackTriggerWiring', 'ContainmentException',
  'AssuranceCaseFixture', 'AssuranceVerdict', 'AssuranceValidity', 'PromotionInput',
  // authority + autonomy + decision + ask (W1/W10)
  'AuthorityGrantArtifact', 'GrantContent', 'GrantScope', 'GrantExpiry', 'AskRequestArtifact',
  'AskContent', 'AskAlternative', 'EvidenceQualitySummary', 'UncertaintyStatement', 'AskRisk',
  'AskRiskSeverity', 'EvidenceQualityClass', 'AutonomyLevel', 'BlastRadius', 'ReversibilityClass',
  'AutonomyRaiseArtifact', 'DecisionRecord', 'DecisionRecordContent', 'DecisionRequest',
  'DecisionRequestSummary', 'DecisionAuthorityTrace', 'DecisionEscalation', 'DecisionResolution',
  'DecisionRuleTraceEntry', 'DecisionEvaluation', 'ImpactClass', 'AskEscalationContext',
  'AskEvidenceSummaryRow',
  // recovery-control (W8)
  'RecoveryDeclarationArtifact', 'RecoveryDeclarationContent', 'RecoveryMechanism',
  'RecoveryTrigger', 'GovernedException',
  // package ecology (W6/W13)
  'PackageArtifact', 'PackageContent', 'PackageRealization', 'ApplicabilityEstimate',
  'QualitativeApplicability', 'CalibratedApplicability', 'ContextCondition', 'DiversityProfile',
  'DiversityDimensionStance', 'DiversityDimension', 'AssuranceObligation', 'AssuranceObligationKind',
  'PackageCompositionArtifact', 'PackageCompositionContent', 'CompositionMember',
  'CompositionBinding', 'CompositionBindingKind', 'JustifiedCombinedProbability',
  'PackageRegistry', 'RegistryEntry', 'RegistryEntryKind', 'RetrievalCandidate', 'RetrievalResult',
  'RetrievalQuery', 'RetrievalAltitude', 'EvidenceContext', 'CandidateUncertainty', 'FailureContext',
  'EvidenceResolver', 'PromoteInput', 'PromoteResult',
  // ui-contracts (W11) — the view-model contracts the console consumes
  'RationaleChain', 'MissionVM', 'SystemStateVM', 'ObservedModelSummaryVM', 'ReconciliationVM',
  'ReconciliationRowVM', 'EvidenceVM', 'EvidenceRowVM', 'EvidenceQueryVM', 'CandidateComparisonVM',
  'CandidateSideVM', 'CandidateEvidenceContextVM', 'AssuranceVM', 'ExperimentVM', 'AskVM',
  'RollbackVM', 'PackageVM', 'RepertoireVM', 'HistoryVM', 'HistoryEntryVM', 'HistoryChainVM',
  'MetaStateVM', 'MetaTaskVM', 'MachineStateSnapshot', 'MachineStateTask', 'UIContractError',
];

describe('the console contains zero domain logic of its own (import-only check)', () => {
  const files = listTypeScriptFiles(srcRoot);
  test('the app has TypeScript sources to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('every import comes from @sos-2/*, node builtins or relative app modules', () => {
    const importPattern = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]!;
        const allowed =
          specifier.startsWith('@sos-2/') ||
          specifier.startsWith('node:') ||
          specifier.startsWith('./') ||
          specifier.startsWith('../');
        expect(
          allowed,
          `${file} imports ${JSON.stringify(specifier)} — the console may only import @sos-2/* workspace packages, node builtins and its own modules`,
        ).toBe(true);
      }
    }
  });

  test('no local declaration shadows the frozen domain vocabulary (redefining domain types is REJECTED)', () => {
    const declarationPattern = /^\s*(?:export\s+)?(?:interface|type|enum|class|abstract class)\s+([A-Za-z0-9_]+)/gm;
    const frozen = new Set(FROZEN_DOMAIN_TYPE_NAMES);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(declarationPattern)) {
        const name = match[1]!;
        expect(
          frozen.has(name),
          `${file} declares ${JSON.stringify(name)} — this is a frozen domain type owned by a workspace package; the console must import it, never redefine it`,
        ).toBe(false);
      }
    }
  });

  test('the app really imports the domain packages (no vendored logic)', () => {
    const allSource = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const pkg of ['@sos-2/semantic-spine', '@sos-2/mission', '@sos-2/ui-contracts']) {
      expect(allSource).toContain(`from '${pkg}'`);
    }
  });
});
