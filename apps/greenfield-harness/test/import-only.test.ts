/**
 * The import-only check — the W14 harness discipline: "the HARNESS APP may
 * have minimal runtime deps but contains ZERO domain logic (imports
 * only)". This test statically enforces it:
 *
 *   1. NO import specifier outside @sos-2/*, node:* builtins and relative
 *      app modules (no third-party domain logic smuggled in);
 *   2. NO local type/interface/enum declaration shadowing the frozen domain
 *      vocabulary (the harness never redefines what the workspace packages
 *      own — it wires and renders only);
 *   3. the domain packages really are the import surface.
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
 * from their public surfaces). The harness may IMPORT these names; it may
 * never DECLARE them.
 */
const FROZEN_DOMAIN_TYPE_NAMES: readonly string[] = [
  // spine / contracts (W0.5)
  'ArtifactEnvelope', 'ArtifactStatus', 'ArtifactKind', 'CoreArtifactKind', 'TraceLink', 'TraceLinkType',
  'EvidenceTruthState', 'EvidenceRecord', 'ConformanceClass', 'ConformanceFinding', 'ClassificationConfig',
  'ImplementationModel', 'ImplementationComponent', 'PackageRecord', 'PackageMaturity', 'ParsedArtifactId',
  // mission (W1)
  'MissionArtifact', 'MissionContent', 'MissionGoal', 'MissionMeasure', 'MissionOutcome', 'MissionStakeholder',
  'MissionAssumption', 'MissionAmbiguity', 'MissionConstraint', 'MissionBound', 'MissionGoalStatus',
  // system state + architecture (W2)
  'SystemStateArtifact', 'SystemStateContent', 'ArchitectureReference', 'SystemStateRevisionRef',
  'ImplementationReference', 'ConfigurationReference', 'DeploymentReference', 'PolicyReference',
  'EnvironmentRelationship', 'ActiveExperimentReference', 'PackageRealizationReference', 'ExactRevision',
  'ArchitectureGraphArtifact', 'ArchitectureGraphContent', 'GraphNode', 'GraphEdge', 'NodeCriticality',
  // evidence + provenance (W3)
  'EvidenceRecordW3', 'EvidenceClass', 'Confidence', 'FreshnessStatus', 'FreshnessEvaluation',
  'EvidenceGraph', 'AvailabilitySummary', 'Producer', 'TimeWindow', 'RawObservation',
  // packages + composition + registry (W6)
  'PackageArtifact', 'PackageContent', 'PackageRealization', 'ApplicabilityEstimate', 'AssuranceObligation',
  'ContextCondition', 'DiversityProfile', 'PackageCompositionArtifact', 'PackageCompositionContent',
  'CompositionMember', 'CompositionBinding', 'RegistryEntry', 'EvidenceResolver', 'RetrievalCandidate',
  'RetrievalAltitude', 'RetrievalResult', 'CandidateUncertainty', 'FailureContext', 'EvidenceContext',
  // search + optimization (W7/W8)
  'CandidateSearchEngine', 'SearchRequest', 'SearchResult', 'SearchCandidate', 'SelectedCandidate',
  'HardConstraintSet', 'HardConstraintView', 'ExplorationPolicy', 'LadderStep', 'CandidateConstraintReport',
  'ParetoCandidate', 'ParetoResult', 'TypedObjective', 'CarriedUncertainty',
  // decision + ask + autonomy + authority (W10)
  'DecisionRequest', 'DecisionRecord', 'DecisionEvaluation', 'DecisionAction', 'DecisionMeta',
  'ImpactClass', 'AuthorityGrantArtifact', 'GrantScope', 'GrantExpiry', 'AskRequestArtifact', 'AskContent',
  'AskAlternative', 'UncertaintyStatement', 'AskRisk', 'AskQueueEntry', 'AskQueue', 'AutonomyRaiseArtifact',
  'BlastRadius', 'ReversibilityClass', 'AutonomyLevel',
  // greenfield (W14 — the orchestrated pipeline the harness runs)
  'GreenfieldPipelineInput', 'GreenfieldPipelineResult', 'GreenfieldPipelineSummary', 'GreenfieldStageRecords',
  'GreenfieldRunContext', 'GreenfieldWorld', 'GreenfieldMissionInput', 'GreenfieldRiskProfile',
  'GreenfieldRealizationPlan', 'GreenfieldAskDecider', 'GreenfieldGoalInput', 'GreenfieldMeasureInput',
  'MissionStageRecord', 'CandidateStageRecord', 'DecisionStageRecord', 'RealizationStageRecord',
  'ReconciliationStageRecord', 'EvidenceStageRecord', 'TraceChainCheck',
];

const ALLOWED_IMPORT = /^(?:@sos-2\/[a-z0-9-]+|node:[a-z][a-z0-9:/-]*|\.{1,2}\/.*)$/;

describe('import-only discipline (zero domain logic in the harness)', () => {
  const files = listTypeScriptFiles(srcRoot);
  test('the harness has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('every import specifier is @sos-2/*, a node builtin or a relative app module', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = [
        ...text.matchAll(/import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g),
        ...text.matchAll(/import\s+['"]([^'"]+)['"]/g),
      ];
      expect(imports.length, `${file} should have imports`).toBeGreaterThan(0);
      for (const match of imports) {
        expect(
          ALLOWED_IMPORT.test(match[1]!),
          `${file} imports forbidden specifier ${JSON.stringify(match[1])} (only @sos-2/*, node:* and relative app modules are allowed)`,
        ).toBe(true);
      }
    }
  });

  test('no local declaration shadows the frozen domain vocabulary', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const declarations = [
        ...text.matchAll(/(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_]+)/g),
        ...text.matchAll(/(?:export\s+)?class\s+([A-Za-z0-9_]+)/g),
      ];
      for (const match of declarations) {
        expect(
          FROZEN_DOMAIN_TYPE_NAMES.includes(match[1]!),
          `${file} declares ${JSON.stringify(match[1])} — a frozen domain name owned by a workspace package (the harness imports domain types; it never redefines them)`,
        ).toBe(false);
      }
    }
  });

  test('the domain packages are the import surface (the harness orchestrates, it does not reimplement)', () => {
    const allText = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(allText).toContain('@sos-2/greenfield');
    expect(allText).toContain('runGreenfieldPipeline');
    // The scenario wires the ecology through the packages' own creators.
    expect(allText).toContain('createPackageComposition');
    expect(allText).toContain('createEvidence');
    expect(allText).toContain('createGrant');
  });
});
