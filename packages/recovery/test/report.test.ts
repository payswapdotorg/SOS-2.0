import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATION_RATIONALE,
  REPORT_TITLE,
  generateReconciliationReport,
  sectionsFromComparisons,
} from '../src/index.js';
import { recoverArchitectureHypotheses, compareWithDeclared } from '../src/index.js';
import { CONFORMANCE_CLASSES } from '@sos-2/semantic-spine';
import {
  CREATED_AT,
  MODEL_ID,
  MODEL_REVISION,
  PROJECTS,
  PROVENANCE,
  ambiguousModel,
  createDeclaredGraphArtifact,
} from './helpers.js';

const BASE_INPUT = { projects_system_state: PROJECTS, provenance: PROVENANCE, created_at: CREATED_AT };

function buildReportInput() {
  const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
  const comparisons = compareWithDeclared(recovery, createDeclaredGraphArtifact());
  return {
    recovery,
    comparisons,
    input: {
      observed_model_id: MODEL_ID,
      observed_model_revision: MODEL_REVISION,
      declared_architecture_id: createDeclaredGraphArtifact().envelope.id,
      sections: sectionsFromComparisons(comparisons),
      ambiguities: recovery.ambiguities,
    },
  };
}

describe('reconciliation report', () => {
  it('explains what we declared, what we observed, what differs and why', () => {
    const { input } = buildReportInput();
    const report = generateReconciliationReport(input);
    // WHAT WE DECLARED
    expect(report).toContain('WHAT WE DECLARED');
    expect(report).toContain(input.declared_architecture_id);
    expect(report).toContain(MODEL_ID);
    expect(report).toContain(`observed revision     : ${MODEL_REVISION}`);
    // WHAT WE OBSERVED
    expect(report).toContain('WHAT WE OBSERVED');
    expect(report).toContain('interpretation(s) under comparison: 4');
    for (const section of input.sections) {
      expect(report).toContain(section.label);
    }
    // WHAT DIFFERS: every finding with its reason AND the frozen belief rationale
    expect(report).toContain('WHAT DIFFERS');
    expect(report).toContain('[PRESERVING_REFINEMENT] store:billing-records');
    expect(report).toContain('[CONTRADICTION] store:audit-log');
    expect(report).toContain('[DRIFT] component:legacy-exports');
    expect(report).toMatch(/why: declared critical node/);
    expect(report).toContain(CLASSIFICATION_RATIONALE['PRESERVING_REFINEMENT']);
    expect(report).toContain(CLASSIFICATION_RATIONALE['DRIFT']);
    // RETAINED AMBIGUITY section carries the recovery markers verbatim
    expect(report).toContain('RETAINED AMBIGUITY');
    expect(report).toContain('[KIND_AMBIGUITY] service');
    expect(report).toContain('alternatives retained: Component, Adapter');
    // SUMMARY: all 7 frozen classes zero-filled
    expect(report).toContain('SUMMARY');
    for (const classification of CONFORMANCE_CLASSES) {
      expect(report).toContain(`${classification}: `);
    }
    expect(report).toContain('subjects requiring human adjudication');
    expect(report).toContain('- store:audit-log');
  });

  it('is deterministic: byte-identical on re-run', () => {
    const first = buildReportInput();
    const second = buildReportInput();
    const reportA = generateReconciliationReport(first.input);
    const reportB = generateReconciliationReport(second.input);
    expect(reportA).toBe(reportB);
    // and re-generating from the SAME input object is byte-identical too
    expect(generateReconciliationReport(first.input)).toBe(reportA);
    // the report is stable under JSON round-trips of its input
    expect(generateReconciliationReport(JSON.parse(JSON.stringify(first.input)))).toBe(reportA);
  });

  it('ends with a trailing newline and uses the default title', () => {
    const { input } = buildReportInput();
    const report = generateReconciliationReport(input);
    expect(report.endsWith('\n')).toBe(true);
    expect(report.startsWith(REPORT_TITLE)).toBe(true);
    expect(report.split('\n')[0]).toBe(REPORT_TITLE);
  });

  it('covers all 7 frozen classes with belief rationales', () => {
    expect(Object.keys(CLASSIFICATION_RATIONALE).sort()).toEqual([...CONFORMANCE_CLASSES].sort());
    for (const classification of CONFORMANCE_CLASSES) {
      expect(CLASSIFICATION_RATIONALE[classification].length).toBeGreaterThan(0);
    }
    // the doc-mandated belief vocabulary is present
    expect(CLASSIFICATION_RATIONALE['IMPLEMENTATION_DETAIL']).toContain('implementation detail');
    expect(CLASSIFICATION_RATIONALE['DRIFT']).toContain('drift');
    expect(CLASSIFICATION_RATIONALE['UNKNOWN']).toContain('unknown');
    expect(CLASSIFICATION_RATIONALE['INTENTIONAL_EVOLUTION']).toContain('intentional');
  });

  it('handles empty section lists deterministically', () => {
    const report = generateReconciliationReport({
      observed_model_id: MODEL_ID,
      observed_model_revision: MODEL_REVISION,
      declared_architecture_id: createDeclaredGraphArtifact().envelope.id,
      sections: [],
    });
    expect(report).toContain('no interpretation was compared');
    expect(report).toContain('total findings: 0');
    expect(report).toContain('CONTRADICTION: 0');
    expect(report).toBe(
      generateReconciliationReport({
        observed_model_id: MODEL_ID,
        observed_model_revision: MODEL_REVISION,
        declared_architecture_id: createDeclaredGraphArtifact().envelope.id,
        sections: [],
      }),
    );
  });

  it('section labels carry hypothesis id, strategy and verdict', () => {
    const { comparisons } = buildReportInput();
    const sections = sectionsFromComparisons(comparisons);
    expect(sections).toHaveLength(4);
    for (const section of sections) {
      expect(section.label).toContain('Hypothesis sos://ArchitectureGraph/');
      expect(section.label).toContain('strategy ');
      expect(section.label).toContain('verdict ');
    }
  });
});
