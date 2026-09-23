// Plain-object config (assembly alignment): the structural import-boundary
// scan covers every .ts file in the owned dirs and allows only relative,
// node:, bare 'vitest', and owned-workspace specifiers — a 'vitest/config'
// subpath import would trip it. Vitest accepts a plain default export.
export default {
  test: {
    include: ['*.test.ts'],
    sequence: { seed: 424242 },
  },
};
