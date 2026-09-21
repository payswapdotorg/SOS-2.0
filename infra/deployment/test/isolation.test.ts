/**
 * Preview/production isolation tests (Work Order P3): tier footprints,
 * cross-tier typed rejections, and the preview-never-mutates-production rule.
 */

import {
  assertFootprintMatchesTier,
  assertPreviewIsolation,
  assertTierIsolation,
  deriveResourceFootprint,
} from '../src/environment/isolation.ts';
import { PreviewIsolationError } from '../src/core/types.ts';
import { fullPreviewSource, fullProductionSource } from './fixtures.ts';

describe('resource footprints', () => {
  it('derives tier-namespaced identities by construction', () => {
    const preview = deriveResourceFootprint('preview', fullPreviewSource());
    const production = deriveResourceFootprint('production', fullProductionSource());
    const previewIds = preview.identities.map((entry) => entry.identity);
    expect(previewIds).toContain('neon:database:sos_preview');
    expect(previewIds).toContain('neon:branch:preview/default');
    expect(previewIds).toContain('r2:prefix:preview/default');
    expect(previewIds).toContain('upstash:namespace:sos:preview:cache');
    expect(previewIds).toContain('upstash:namespace:sos:preview:leases');
    const productionIds = production.identities.map((entry) => entry.identity);
    expect(productionIds).toContain('neon:database:sos');
    expect(productionIds).toContain('neon:branch:main');
    expect(productionIds).toContain('r2:prefix:production');
    expect(productionIds).toContain('upstash:namespace:sos:production:cache');
  });

  it('requires the DATABASE_URL connection to point at the TIER database (public identity only)', () => {
    // A preview source whose connection string points at the PRODUCTION
    // database is typed-rejected — even though the string itself is a
    // secret, only its public database-name segment is compared.
    const crossingSource = {
      ...fullPreviewSource(),
      DATABASE_URL: 'postgres://sos:somepw@ep-prod-main-01.aws.neon.tech/sos?sslmode=require',
    };
    expect(() => deriveResourceFootprint('preview', crossingSource)).toThrow(PreviewIsolationError);
    try {
      deriveResourceFootprint('preview', crossingSource);
      expect.unreachable('cross-tier connection must be rejected');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('neon:database:sos_preview');
      expect(message).not.toContain('somepw'); // credentials never surface
    }
  });

  it('accepts a correctly-pointed connection (no false positives)', () => {
    expect(() => deriveResourceFootprint('preview', fullPreviewSource())).not.toThrow();
    expect(() => deriveResourceFootprint('production', fullProductionSource())).not.toThrow();
  });
});

describe('tier-match gate (a footprint cannot carry another tier identities)', () => {
  it('accepts honest footprints for all three tiers', () => {
    expect(() => assertFootprintMatchesTier(deriveResourceFootprint('preview', fullPreviewSource()))).not.toThrow();
    expect(() =>
      assertFootprintMatchesTier(deriveResourceFootprint('production', fullProductionSource())),
    ).not.toThrow();
    expect(() => assertFootprintMatchesTier(deriveResourceFootprint('local', {}))).not.toThrow();
  });

  it('type-rejects a preview footprint carrying a production identity', () => {
    const honest = deriveResourceFootprint('preview', fullPreviewSource());
    const corrupted = {
      tier: 'preview' as const,
      identities: [
        ...honest.identities,
        { provider: 'neon' as const, kind: 'database', identity: 'neon:database:sos', tier: 'production' as const },
      ],
    };
    expect(() => assertFootprintMatchesTier(corrupted)).toThrow(PreviewIsolationError);
    expect(() => assertFootprintMatchesTier(corrupted)).toThrow(/neon:database:sos/);
  });

  it('type-rejects a production footprint carrying a preview identity', () => {
    const honest = deriveResourceFootprint('production', fullProductionSource());
    const corrupted = {
      tier: 'production' as const,
      identities: [
        ...honest.identities,
        { provider: 'r2' as const, kind: 'prefix', identity: 'r2:prefix:preview/default', tier: 'preview' as const },
      ],
    };
    expect(() => assertFootprintMatchesTier(corrupted)).toThrow(/preview/);
  });

  it('type-rejects a footprint with the wrong Vercel environment dimension', () => {
    const honest = deriveResourceFootprint('preview', fullPreviewSource());
    const corrupted = {
      tier: 'preview' as const,
      identities: [
        ...honest.identities.filter((entry) => entry.provider !== 'vercel'),
        { provider: 'vercel' as const, kind: 'environment-dimension', identity: 'vercel:project:x:production', tier: 'preview' as const },
      ],
    };
    expect(() => assertFootprintMatchesTier(corrupted)).toThrow(/environment dimension/);
  });
});

describe('preview NEVER mutates production', () => {
  it('a full honest preview footprint shares nothing with production', () => {
    expect(() =>
      assertPreviewIsolation(fullPreviewSource(), fullProductionSource()),
    ).not.toThrow();
  });

  it('type-rejects ANY shared identity between preview and production', () => {
    const preview = deriveResourceFootprint('preview', fullPreviewSource());
    const production = deriveResourceFootprint('production', fullProductionSource());
    const collidingProduction = {
      tier: 'production' as const,
      identities: [
        ...production.identities.filter((entry) => entry.kind !== 'database'),
        { provider: 'neon' as const, kind: 'database', identity: 'neon:database:sos_preview', tier: 'production' as const },
      ],
    };
    // The corrupted production footprint itself is first caught by the
    // tier-match gate; assertTierIsolation catches shared identities even
    // between structurally well-formed footprints:
    const previewWithProdDb = {
      tier: 'preview' as const,
      identities: preview.identities,
    };
    void previewWithProdDb;
    expect(() => assertTierIsolation(preview, collidingProduction)).toThrow(PreviewIsolationError);
    expect(() => assertTierIsolation(preview, collidingProduction)).toThrow(/neon:database:sos_preview/);
  });

  it('rejects misuse of the isolation gate (wrong tier arguments)', () => {
    const preview = deriveResourceFootprint('preview', fullPreviewSource());
    const production = deriveResourceFootprint('production', fullProductionSource());
    expect(() => assertTierIsolation(production, preview)).toThrow(/preview footprint with a production footprint/);
    expect(() => assertTierIsolation(preview, preview)).toThrow(/preview footprint with a production footprint/);
  });
});
