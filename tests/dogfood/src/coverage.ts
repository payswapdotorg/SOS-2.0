/**
 * The W17 dogfood coverage manifest — the machine-checkable source of truth
 * that binds every requirement R1-R31 to the exact dogfood test case,
 * stage and revision token that exercises it.
 *
 * `docs/evidence/dogfood/coverage-ledger.json` MUST agree with this module
 * exactly (test/coverage-ledger.test.ts enforces the agreement); the dogfood
 * suite sources its test titles from DOGFOOD_CASES, so a ledger entry can
 * never reference a test that does not exist.
 */

/** The exact revision tokens referenced by the coverage ledger. */
export const REVISION_TOKENS = {
  /** The exact source revision of the greenfield realization (40-hex git sha). */
  realizedRevision: '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2',
  /** The realized SystemState revision chain token (root v1, ACTIVE). */
  systemStateRevision: 'system-state@v1',
  /** The meta process revision chain token (v1 -> v3 across the loop). */
  metaProcessRevision: 'meta-process@v1..v3',
  /** The canonical evidence/pipeline provenance of the W17 dogfood run. */
  dogfoodProvenance: 'W17:dogfood',
} as const;

/** Every dogfood test case title (the suite renders exactly these). */
export const DOGFOOD_CASES = {
  missionFormalization: 'mission formalization: the raw mission becomes a governed, versioned Mission artifact with progressive goal measurability',
  missionEvolution: 'mission evolution: an explicit, authority-controlled revision produces Mission v2 with a DERIVED_FROM chain',
  valueModelSubordination: 'value model: a separate ValueModel is created subordinated to the mission, and a budget conflict is surfaced as a CONFLICTS_WITH link',
  contextArtifact: 'context: a Context artifact conditions the realization (production, edge platform, GDPR cohort)',
  greenfieldAskPath: 'greenfield (W14 stages, ASK path): mission -> candidate at the highest validated altitude -> ASK escalation -> human resolution -> realization -> reconciliation -> evidence',
  greenfieldActPath: 'greenfield decision point (ACT path): with a covering grant presented, the engine acts directly',
  realizationRevisionDiscipline: 'realization: the System State revision, declared ArchitectureGraph hypothesis and ImplementationModel are mutually consistent at the exact realized revision',
  greenfieldReconciliation: 'greenfield reconciliation: the realized implementation vs the declared architecture classifies honestly (PRESERVING_REFINEMENT + IMPLEMENTATION_DETAIL)',
  truthfulEvidenceGap: 'evidence: the unobserved cold-start probe stays UNAVAILABLE (never folded into success or zero), and OTel telemetry is ingested platform-neutrally',
  packageEcology: 'package ecology: validated member packages, a VALIDATED composition with its OWN evidence (member evidence never substitutes), and a diverse multi-family repertoire',
  brownfieldNominal: 'brownfield (W15 stages, nominal world): the greenfield-realized system is ingested, recovered into competing hypotheses, optimized, assured, experimented, gated, reconciled and learned',
  brownfieldDegraded: 'brownfield decision point (degraded world): the guardrail breach drives ROLLBACK with a bounded recovery declaration',
  metaEvolution: 'self-evolution (W16 stages): the meta loop runs over the same object system — separation, proposals, governance guard, effectiveness, decisions (REJECT/ROLLBACK/ASK/ACT), rollback restore and liability memory',
  causalGrounding: 'causal grounding: an observational correlation is promoted to a CORRELATIONAL hypothesis through the only sanctioned path (no strong causal claim without intervention)',
  integratedTraceChain: 'integrated trace chain: ONE connected semantic subgraph from the Mission to the learned ecology updates, with directed query paths across all three loops',
  explainability: 'explainability: the realized SystemState exposes a valid rationale chain and the evidence pool projects onto a deterministic evidence view model',
  determinism: 'determinism: the entire integrated scenario is a pure function of its input (byte-identical canonical projection across runs)',
} as const;

export type DogfoodCase = (typeof DOGFOOD_CASES)[keyof typeof DOGFOOD_CASES];

/** The requirement -> test case map (the code-side twin of coverage-ledger.json). */
export const REQUIREMENT_CASES: Readonly<Record<string, readonly DogfoodCase[]>> = {
  R1: [DOGFOOD_CASES.missionFormalization, DOGFOOD_CASES.greenfieldAskPath],
  R2: [DOGFOOD_CASES.missionFormalization],
  R3: [DOGFOOD_CASES.missionEvolution],
  R4: [DOGFOOD_CASES.valueModelSubordination],
  R5: [DOGFOOD_CASES.contextArtifact, DOGFOOD_CASES.brownfieldNominal],
  R6: [DOGFOOD_CASES.greenfieldAskPath, DOGFOOD_CASES.brownfieldNominal],
  R7: [DOGFOOD_CASES.realizationRevisionDiscipline],
  R8: [DOGFOOD_CASES.realizationRevisionDiscipline, DOGFOOD_CASES.brownfieldNominal],
  R9: [DOGFOOD_CASES.integratedTraceChain],
  R10: [DOGFOOD_CASES.causalGrounding],
  R11: [DOGFOOD_CASES.brownfieldNominal],
  R12: [DOGFOOD_CASES.brownfieldNominal],
  R13: [DOGFOOD_CASES.brownfieldNominal, DOGFOOD_CASES.brownfieldDegraded],
  R14: [DOGFOOD_CASES.brownfieldDegraded],
  R15: [DOGFOOD_CASES.greenfieldAskPath, DOGFOOD_CASES.greenfieldActPath, DOGFOOD_CASES.metaEvolution],
  R16: [DOGFOOD_CASES.greenfieldAskPath, DOGFOOD_CASES.metaEvolution],
  R17: [DOGFOOD_CASES.contextArtifact, DOGFOOD_CASES.brownfieldNominal],
  R18: [DOGFOOD_CASES.truthfulEvidenceGap, DOGFOOD_CASES.brownfieldNominal],
  R19: [DOGFOOD_CASES.brownfieldNominal, DOGFOOD_CASES.metaEvolution],
  R20: [DOGFOOD_CASES.metaEvolution],
  R21: [DOGFOOD_CASES.truthfulEvidenceGap, DOGFOOD_CASES.brownfieldNominal],
  R22: [DOGFOOD_CASES.explainability],
  R23: [DOGFOOD_CASES.greenfieldReconciliation, DOGFOOD_CASES.brownfieldNominal],
  R24: [DOGFOOD_CASES.packageEcology],
  R25: [DOGFOOD_CASES.packageEcology],
  R26: [DOGFOOD_CASES.brownfieldNominal],
  R27: [DOGFOOD_CASES.packageEcology],
  R28: [DOGFOOD_CASES.packageEcology, DOGFOOD_CASES.brownfieldNominal],
  R29: [DOGFOOD_CASES.greenfieldAskPath, DOGFOOD_CASES.brownfieldNominal],
  R30: [DOGFOOD_CASES.realizationRevisionDiscipline, DOGFOOD_CASES.integratedTraceChain, DOGFOOD_CASES.determinism],
  R31: [DOGFOOD_CASES.metaEvolution],
};

/** The stage label of each dogfood case (also asserted by the ledger test). */
export const CASE_STAGES: Readonly<Record<DogfoodCase, string>> = {
  [DOGFOOD_CASES.missionFormalization]: 'mission formalization (W14 stage 1)',
  [DOGFOOD_CASES.missionEvolution]: 'mission revision (@sos-2/mission)',
  [DOGFOOD_CASES.valueModelSubordination]: 'value model subordination (@sos-2/value)',
  [DOGFOOD_CASES.contextArtifact]: 'context artifact (@sos-2/context)',
  [DOGFOOD_CASES.greenfieldAskPath]: 'greenfield pipeline stages 1-6 (W14, ASK path)',
  [DOGFOOD_CASES.greenfieldActPath]: 'greenfield decision flow (W14 stage 3, ACT path)',
  [DOGFOOD_CASES.realizationRevisionDiscipline]: 'greenfield realization (W14 stage 4)',
  [DOGFOOD_CASES.greenfieldReconciliation]: 'greenfield reconciliation (W14 stage 5)',
  [DOGFOOD_CASES.truthfulEvidenceGap]: 'greenfield evidence ingestion (W14 stage 6) + telemetry ingestion (W15 stage 1)',
  [DOGFOOD_CASES.packageEcology]: 'package ecology (@sos-2/packages + @sos-2/composition + @sos-2/registry)',
  [DOGFOOD_CASES.brownfieldNominal]: 'brownfield loop stages 1-9 (W15, nominal world)',
  [DOGFOOD_CASES.brownfieldDegraded]: 'brownfield promotion/rollback (W15 stages 6-7, degraded world)',
  [DOGFOOD_CASES.metaEvolution]: 'meta-evolution loop stages 1-7 (W16)',
  [DOGFOOD_CASES.causalGrounding]: 'causal grounding (@sos-2/causal)',
  [DOGFOOD_CASES.integratedTraceChain]: 'integrated trace chain (W17 connective tissue)',
  [DOGFOOD_CASES.explainability]: 'rationale + evidence view models (@sos-2/ui-contracts)',
  [DOGFOOD_CASES.determinism]: 'whole-scenario determinism (W17)',
};
