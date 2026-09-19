/**
 * Package record — aligned 1:1 with spec/contracts/package.schema.json
 * ($id: sos://schema/package; required: id, semantic_capability, contracts,
 * maturity, evidence_refs; additionalProperties: false).
 *
 * Named "PackageRecord" (not "Package") to avoid confusion with the artifact
 * KIND string and with packaging manifests.
 */

export const PACKAGE_MATURITIES = [
  'DISCOVERED',
  'FORMING',
  'VALIDATED',
  'MATURE',
  'CONTEXTUALIZED',
  'SUPERSEDED',
  'RETIRED',
] as const;

export type PackageMaturity = (typeof PACKAGE_MATURITIES)[number];

const PACKAGE_MATURITY_SET: ReadonlySet<string> = new Set(PACKAGE_MATURITIES);

export function isPackageMaturity(value: unknown): value is PackageMaturity {
  return typeof value === 'string' && PACKAGE_MATURITY_SET.has(value);
}

export interface PackageRecord {
  /** Package artifact id (sos://Package/<segment>). */
  id: string;
  /** Human-readable statement of the reusable semantic capability. */
  semantic_capability: string;
  /** Contract ids the package realizes (e.g. sos://schema/* references). */
  contracts: string[];
  /** Package maturity (frozen vocabulary above). */
  maturity: PackageMaturity;
  /** Evidence artifact ids supporting the package. */
  evidence_refs: string[];
  /** Negative-evidence artifact ids (failures are retained, never dropped). */
  failure_refs?: string[];
  /** Compatibility evidence artifact ids. */
  compatibility_refs?: string[];
  /** Composition evidence artifact ids. */
  composition_refs?: string[];
}

const PACKAGE_RECORD_KEYS = [
  'id',
  'semantic_capability',
  'contracts',
  'maturity',
  'evidence_refs',
  'failure_refs',
  'compatibility_refs',
  'composition_refs',
] as const;

export function isPackageRecord(value: unknown): value is PackageRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = new Set<string>(PACKAGE_RECORD_KEYS);
  if (!actual.every((key) => expected.has(key))) {
    return false;
  }
  if (
    !['id', 'semantic_capability', 'contracts', 'maturity', 'evidence_refs'].every((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return false;
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return false;
  }
  if (typeof record.semantic_capability !== 'string' || record.semantic_capability.length === 0) {
    return false;
  }
  if (!Array.isArray(record.contracts) || !record.contracts.every((entry) => typeof entry === 'string')) {
    return false;
  }
  if (!isPackageMaturity(record.maturity)) {
    return false;
  }
  if (!Array.isArray(record.evidence_refs) || !record.evidence_refs.every((entry) => typeof entry === 'string')) {
    return false;
  }
  for (const key of ['failure_refs', 'compatibility_refs', 'composition_refs'] as const) {
    const list = record[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string'))) {
      return false;
    }
  }
  return true;
}
