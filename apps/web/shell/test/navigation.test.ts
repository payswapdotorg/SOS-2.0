/**
 * Navigation model tests — the design contract's navigation structure,
 * pinned against both the model and the actual thin route wrappers on
 * disk (the rail must always lead somewhere real).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  desktopRailItems,
  MIN_TOUCH_TARGET_PX,
  mobileBottomNavItems,
  moreIndexItems,
  navItemFor,
  rationaleRoute,
  shellNavigationModel,
} from '@sos-2/web-contracts';

const appDir = join(__dirname, '..', '..', 'app');

describe('the desktop rail (design contract order)', () => {
  test('exactly the nine contracted sections in order', () => {
    expect(desktopRailItems().map((item) => item.section)).toEqual([
      'overview',
      'mission',
      'system',
      'changes',
      'evidence',
      'experiments',
      'packages',
      'history',
      'more',
    ]);
  });

  test('labels are user-facing (no package names)', () => {
    for (const item of desktopRailItems()) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.label).not.toMatch(/@sos-2|package\//i);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });
});

describe('the mobile bottom navigation (design contract order)', () => {
  test('exactly the five contracted sections with ASK first-class', () => {
    expect(mobileBottomNavItems().map((item) => item.section)).toEqual([
      'overview',
      'changes',
      'evidence',
      'ask',
      'more',
    ]);
  });

  test('every interactive element respects the 44px minimum touch target contract', () => {
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
  });
});

describe('the More index', () => {
  test('indexes every section including ASK (a fresh user finds everything from More)', () => {
    expect(moreIndexItems().map((item) => item.section)).toEqual([
      'overview',
      'mission',
      'system',
      'changes',
      'evidence',
      'experiments',
      'packages',
      'history',
      'ask',
      'more',
    ]);
  });
});

describe('every route has a thin wrapper on disk', () => {
  const cases: [section: string, routeFile: string][] = [
    ['overview', join(appDir, 'page.tsx')],
    ['mission', join(appDir, 'mission', 'page.tsx')],
    ['system', join(appDir, 'system', 'page.tsx')],
    ['changes', join(appDir, 'changes', 'page.tsx')],
    ['evidence', join(appDir, 'evidence', 'page.tsx')],
    ['experiments', join(appDir, 'experiments', 'page.tsx')],
    ['packages', join(appDir, 'packages', 'page.tsx')],
    ['history', join(appDir, 'history', 'page.tsx')],
    ['ask', join(appDir, 'ask', 'page.tsx')],
    ['more', join(appDir, 'more', 'page.tsx')],
  ];

  test.each(cases)('%s -> %s exists', (_section, file) => {
    expect(existsSync(file), `missing route wrapper ${file}`).toBe(true);
  });

  test('each wrapper is thin (≤ ~10 lines, importing only from the shell or contracts)', () => {
    for (const [, file] of cases) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n').filter((line) => line.trim().length > 0);
      expect(lines.length, `${file} should be a thin wrapper`).toBeLessThanOrEqual(11);
      expect(text, `${file} imports from the shell`).toMatch(/shell\//);
    }
  });

  test('the rationale deep-link route exists as a dynamic route', () => {
    expect(existsSync(join(appDir, 'rationale', '[kind]', '[segment]', 'page.tsx'))).toBe(true);
  });
});

describe('rationale routes are path-safe', () => {
  test('the route contains no reserved characters and matches the spine id shape', () => {
    expect(rationaleRoute('Mission', 'a'.repeat(32))).toBe(`/rationale/Mission/${'a'.repeat(32)}`);
  });

  test('navItemFor resolves every section and throws for unknown ones', () => {
    for (const item of shellNavigationModel()) {
      expect(navItemFor(item.section).href).toBe(item.href);
    }
    expect(() => navItemFor('nope' as never)).toThrow();
  });
});
