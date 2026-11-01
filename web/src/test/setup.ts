import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The UI formats with the visitor's locale. Pin it for tests so results do not depend on the machine running them.
const NativeNumberFormat = Intl.NumberFormat;
const NativeDateTimeFormat = Intl.DateTimeFormat;
Intl.NumberFormat = function (locales?: string | string[], options?: Intl.NumberFormatOptions) {
  return new NativeNumberFormat(locales ?? 'en-US', options);
} as unknown as typeof Intl.NumberFormat;
Intl.DateTimeFormat = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
  return new NativeDateTimeFormat(locales ?? 'en-US', { timeZone: 'UTC', ...options });
} as unknown as typeof Intl.DateTimeFormat;

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable: nothing to reset */
  }
});
