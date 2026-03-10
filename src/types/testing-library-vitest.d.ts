// Ambient type declarations for testing dependencies
// These declarations allow TypeScript to compile without the actual packages installed
// They provide minimal typing to satisfy the LSP

declare module '@testing-library/react' {
  export function cleanup(): void;
  // Other exports are implicitly any
}

declare module 'vitest' {
  export function afterAll(fn: () => void): void;
  export function afterEach(fn: () => void): void;
  export function beforeAll(fn: () => void): void;
  export function beforeEach(fn: () => void): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): any;
  export const vi: any;
  // Other vitest exports are implicitly any
}

declare module '@testing-library/jest-dom' {
  // This module extends expect with custom matchers, no exports needed
}
