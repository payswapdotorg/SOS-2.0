import fc from 'fast-check';

// Pinned seed: property tests are deterministic and reproducible across runs
// (required by W0.5 verification: identical results on repeated runs).
fc.configureGlobal({ seed: 424242 });
