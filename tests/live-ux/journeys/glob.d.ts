/**
 * The Vite `import.meta.glob` type, declared locally (Work Order P18-C):
 * vitest runs on Vite so the runtime supports it; declaring the minimal
 * shape here keeps the suite typechecking WITHOUT adding a vite/client
 * type dependency edge to this package (the tests/* precedent: zero
 * dependencies beyond the declared toolchain).
 */
declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string | readonly string[]): Record<string, () => Promise<T>>;
  }
}

export {};
