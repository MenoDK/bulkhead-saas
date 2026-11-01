import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMinimumPresentation } from './useMinimumPresentation';

describe('useMinimumPresentation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the splash up for the whole floor even if loading ends at once', () => {
    const { result } = renderHook(({ loading }) => useMinimumPresentation(loading, 1000), {
      initialProps: { loading: false },
    });
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(999));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current).toBe(false);
  });

  it('does not add delay to a slow load: hides as soon as loading ends after the floor', () => {
    const { result, rerender } = renderHook(({ loading }) => useMinimumPresentation(loading, 1000), {
      initialProps: { loading: true },
    });
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(false);
  });

  it('stays up while loading even after the floor passed', () => {
    const { result } = renderHook(() => useMinimumPresentation(true, 100));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(true);
  });

  it('a zero floor disables the behaviour', () => {
    const { result } = renderHook(() => useMinimumPresentation(false, 0));
    expect(result.current).toBe(false);
  });
});
