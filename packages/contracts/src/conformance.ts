/**
 * Conformance classes — the 7 frozen classifications for architecture /
 * implementation differences from spec/architecture.md §6 and
 * docs/code-to-architecture.md.
 */

export const CONFORMANCE_CLASSES = [
  'IMPLEMENTATION_DETAIL',
  'EXPECTED_VARIATION',
  'PRESERVING_REFINEMENT',
  'INTENTIONAL_EVOLUTION',
  'DRIFT',
  'UNKNOWN',
  'CONTRADICTION',
] as const;

export type ConformanceClass = (typeof CONFORMANCE_CLASSES)[number];

const CONFORMANCE_CLASS_SET: ReadonlySet<string> = new Set(CONFORMANCE_CLASSES);

export function isConformanceClass(value: unknown): value is ConformanceClass {
  return typeof value === 'string' && CONFORMANCE_CLASS_SET.has(value);
}
