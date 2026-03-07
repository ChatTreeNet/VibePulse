// Ambient type declarations for testing dependencies
// These declarations allow TypeScript to compile without the actual packages installed
// They provide minimal typing to satisfy the LSP

declare module '@testing-library/react' {
  export function cleanup(): void;
  // Other exports are implicitly any
}

declare module 'vitest' {
  export function afterEach(fn: () => void): void;
  // Other vitest exports are implicitly any
}

declare module '@testing-library/jest-dom' {
  // This module extends expect with custom matchers, no exports needed
}
