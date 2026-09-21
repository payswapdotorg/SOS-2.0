/**
 * State-block selection — the pure view-state rule that maps a surface's
 * load outcome onto the first-class state-block model (loading / empty /
 * unknown / unavailable / partial / error). A page NEVER shows a blank hole
 * or a fabricated default: every surface renders either READY data or a
 * NAMED state block that says what is known and what can happen next.
 */

import { buildStateBlock, type StateBlock } from '@sos-2/web-contracts';

/** What a surface knows about its own data (the shell's load outcomes). */
export type SurfaceLoad<T> =
  | { status: 'READY'; data: T }
  | { status: 'LOADING'; surface: string; what: string }
  | { status: 'EMPTY'; surface: string; what: string; action: string | null }
  | { status: 'UNKNOWN'; surface: string; what: string; action: string | null }
  | { status: 'UNAVAILABLE'; surface: string; what: string; action: string }
  | { status: 'PARTIAL'; surface: string; what: string; present: string[]; missing: string[] }
  | { status: 'ERROR'; surface: string; what: string; action: string };

/** The selection result: ready data or a named block (never a blank hole). */
export type SelectedSurface<T> = { ready: true; data: T } | { ready: false; block: StateBlock };

/**
 * Select the state block for a surface load (pure, total, deterministic).
 * Each status maps to exactly one named block kind — LOADING says what is
 * loading, EMPTY says what is absent, UNKNOWN says what is not known,
 * UNAVAILABLE says what cannot be reached (with an honest next step),
 * PARTIAL lists present and missing parts, ERROR carries the failure and a
 * next step.
 */
export function selectStateBlock<T>(load: SurfaceLoad<T>): SelectedSurface<T> {
  switch (load.status) {
    case 'READY':
      return { ready: true, data: load.data };
    case 'LOADING':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'LOADING',
          surface: load.surface,
          statement: `${load.what} is being loaded.`,
          action: 'The content appears here as soon as the read completes.',
        }),
      };
    case 'EMPTY':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'EMPTY',
          surface: load.surface,
          statement: `${load.what}: nothing exists here yet.`,
          action: load.action,
        }),
      };
    case 'UNKNOWN':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'UNKNOWN',
          surface: load.surface,
          statement: `${load.what} is not known yet — no value is guessed.`,
          action: load.action,
        }),
      };
    case 'UNAVAILABLE':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'UNAVAILABLE',
          surface: load.surface,
          statement: `${load.what} cannot be reached right now.`,
          action: load.action,
        }),
      };
    case 'PARTIAL':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'PARTIAL',
          surface: load.surface,
          statement: `${load.what} is partially available.`,
          present: load.present,
          missing: load.missing,
          action: 'The missing parts stay explicitly missing — nothing is fabricated for them.',
        }),
      };
    case 'ERROR':
      return {
        ready: false,
        block: buildStateBlock({
          kind: 'ERROR',
          surface: load.surface,
          statement: `${load.what} failed to load.`,
          action: load.action,
        }),
      };
  }
}

/**
 * The standard honest blocks this console wave renders for surfaces whose
 * live data plane is not connected yet (P2) or whose dataset section is
 * genuinely empty — pre-built, deterministic, reused across pages.
 */
export const notConnectedBlock = (surface: string, what: string): StateBlock =>
  buildStateBlock({
    kind: 'UNAVAILABLE',
    surface,
    statement: `${what} is not connected in this console build.`,
    action: 'This surface lights up when the live data plane is connected; nothing is simulated in its place.',
  });

export const emptySectionBlock = (surface: string, what: string): StateBlock =>
  buildStateBlock({
    kind: 'EMPTY',
    surface,
    statement: `${what}: none exist in this dataset yet.`,
    action: 'This block is shown instead of a blank space — absence is information too.',
  });
