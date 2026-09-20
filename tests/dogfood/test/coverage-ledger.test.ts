/**
 * The W17 REQUIREMENT COVERAGE LEDGER machine check.
 *
 * docs/evidence/dogfood/coverage-ledger.json maps every requirement R1-R31
 * to the exact test case(s) + stage + revision that exercises it. This suite
 * enforces that the ledger is machine-checkably consistent with the CODE:
 *
 *   1. the ledger covers ALL 31 requirements with ZERO gaps (a missing R#
 *      fails the suite);
 *   2. every ledger test case is a REAL test title (the dogfood suite
 *      renders its titles from the same DOGFOOD_CASES constants);
 *   3. the ledger's case map equals the code-side manifest exactly;
 *   4. every stage label matches the manifest's stage map;
 *   5. every revision token is one of the exact tokens the scenario asserts;
 *   6. every dogfood case is referenced by at least one requirement (no
 *      orphan, un-attributed proof steps).
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DOGFOOD_CASES, CASE_STAGES, REQUIREMENT_CASES, REVISION_TOKENS } from '../src/coverage.js';

const LEDGER_PATH = new URL('../../../docs/evidence/dogfood/coverage-ledger.json', import.meta.url);

interface LedgerEntry {
  requirement: string;
  statement: string;
  test_file: string;
  test_cases: string[];
  stage: string;
  revision: string;
}

interface CoverageLedger {
  ledger: 'sos-2.0-w17-requirement-coverage';
  work_order: string;
  base_commit: string;
  generated_by: string;
  notes: string[];
  requirements: LedgerEntry[];
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as CoverageLedger;

const ALL_REQUIREMENTS = Array.from({ length: 31 }, (_, index) => `R${index + 1}`);
const ALL_CASE_TITLES = new Set(Object.values(DOGFOOD_CASES));
const VALID_REVISION_TOKENS = new Set<string>(Object.values(REVISION_TOKENS));

test('the ledger file exists and is the W17 requirement coverage ledger', () => {
  expect(ledger.ledger).toBe('sos-2.0-w17-requirement-coverage');
  expect(ledger.work_order).toBe('W17');
  expect(ledger.base_commit).toBe('152eff1b5e01adc3ac3742552e0477aad3209578');
  expect(Array.isArray(ledger.requirements)).toBe(true);
});

test('the ledger covers ALL 31 requirements R1-R31 with zero gaps', () => {
  const indexed = new Map(ledger.requirements.map((entry) => [entry.requirement, entry]));
  const missing: string[] = [];
  for (const requirement of ALL_REQUIREMENTS) {
    if (!indexed.has(requirement)) {
      missing.push(requirement);
    }
  }
  expect(missing, `requirements missing from the ledger: ${missing.join(', ')}`).toEqual([]);
  expect(ledger.requirements.length).toBe(31);
  // No duplicates, no out-of-scope entries.
  expect(new Set(ledger.requirements.map((entry) => entry.requirement)).size).toBe(31);
  for (const entry of ledger.requirements) {
    expect(ALL_REQUIREMENTS).toContain(entry.requirement);
  }
});

test('every ledger test case is a REAL dogfood test title (rendered from DOGFOOD_CASES)', () => {
  for (const entry of ledger.requirements) {
    expect(entry.test_file).toBe('tests/dogfood/test/dogfood.test.ts');
    expect(entry.test_cases.length).toBeGreaterThan(0);
    for (const testCase of entry.test_cases) {
      expect(
        ALL_CASE_TITLES.has(testCase),
        `${entry.requirement} references unknown test case: ${testCase}`,
      ).toBe(true);
    }
  }
});

test('the ledger case map equals the code-side manifest exactly', () => {
  for (const entry of ledger.requirements) {
    const manifestCases = REQUIREMENT_CASES[entry.requirement];
    expect(manifestCases, `no manifest entry for ${entry.requirement}`).toBeDefined();
    expect([...manifestCases!].sort()).toEqual([...entry.test_cases].sort());
  }
  // And the reverse direction: every manifest requirement is in the ledger.
  for (const requirement of Object.keys(REQUIREMENT_CASES)) {
    expect(ledger.requirements.some((entry) => entry.requirement === requirement)).toBe(true);
  }
});

test('every ledger stage label matches the manifest stage map', () => {
  for (const entry of ledger.requirements) {
    for (const testCase of entry.test_cases) {
      expect(CASE_STAGES[testCase as keyof typeof CASE_STAGES], `no stage label for case: ${testCase}`).toBeDefined();
    }
    // The entry's stage label is the stage of its FIRST test case.
    expect(entry.stage).toBe(CASE_STAGES[entry.test_cases[0] as keyof typeof CASE_STAGES]);
  }
});

test('every ledger revision token is an exact scenario revision token', () => {
  for (const entry of ledger.requirements) {
    expect(entry.revision.length).toBeGreaterThan(0);
    expect(
      VALID_REVISION_TOKENS.has(entry.revision),
      `${entry.requirement} carries an unknown revision token: ${entry.revision}`,
    ).toBe(true);
  }
  // Spot-check the exact-revision discipline anchors.
  const r7 = ledger.requirements.find((entry) => entry.requirement === 'R7')!;
  expect(r7.revision).toBe(REVISION_TOKENS.realizedRevision);
  const r30 = ledger.requirements.find((entry) => entry.requirement === 'R30')!;
  expect(r30.revision).toBe(REVISION_TOKENS.dogfoodProvenance);
});

test('every dogfood case is referenced by at least one requirement (no orphan proof steps)', () => {
  const referenced = new Set(ledger.requirements.flatMap((entry) => entry.test_cases));
  for (const testCase of Object.values(DOGFOOD_CASES)) {
    expect(
      referenced.has(testCase),
      `dogfood case referenced by no requirement: ${testCase}`,
    ).toBe(true);
  }
});

test('the W17 Architecture Delta record is present and schema-shaped', () => {
  const delta = JSON.parse(
    readFileSync(new URL('../../../docs/evidence/dogfood/ARCHITECTURE-DELTA.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  // The frozen architecture-delta contract: exactly the 8 declared keys
  // (additionalProperties: false), with affected_artifacts + preserved_invariants
  // required and non-empty (spec/contracts/architecture-delta.schema.json).
  const expectedKeys = [
    'affected_artifacts',
    'added',
    'removed',
    'modified',
    'preserved_invariants',
    'boundary_changes',
    'rationale_ref',
    'work_order',
  ];
  expect(Object.keys(delta).sort()).toEqual([...expectedKeys].sort());
  expect((delta.affected_artifacts as string[]).length).toBeGreaterThan(0);
  expect((delta.preserved_invariants as string[]).length).toBeGreaterThan(0);
  expect(delta.work_order).toBe('W17');
  expect(delta.rationale_ref).toBe('spec/work-orders/W17-integrated-dogfood.md');
  // Implementation-only discipline: nothing was removed or modified.
  expect(delta.removed).toEqual([]);
  expect(delta.modified).toEqual([]);
});
