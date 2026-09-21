export default {
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
  },
};
