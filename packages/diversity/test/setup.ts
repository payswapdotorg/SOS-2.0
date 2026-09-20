import fc from 'fast-check';

// Pinned seed: property tests are deterministic and reproducible across runs
// (same discipline as the W6/W7 sibling packages — identical results on repeated runs).
fc.configureGlobal({ seed: 424242 });
