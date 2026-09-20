import fc from 'fast-check';

// Pinned seed: property tests are deterministic and reproducible across runs
// (same discipline as W0.5-W13 — identical results on repeated runs).
fc.configureGlobal({ seed: 424242 });
