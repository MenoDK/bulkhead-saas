import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { THEMES } from './tokens';

function Probe() {
  const { niche, mode, setNiche, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="state">{`${niche}/${mode}`}</span>
      <button onClick={() => setNiche('legal')}>legal</button>
      <button onClick={() => setPreference('dark')}>dark</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('applies the niche palette to the document root before paint', async () => {
    render(
      <ThemeProvider initial={{ niche: 'restaurant', preference: 'light' }}>
        <Probe />
      </ThemeProvider>,
    );
    const root = document.documentElement;
    expect(root.dataset.niche).toBe('restaurant');
    expect(root.style.getPropertyValue('--brand')).toBe(THEMES.restaurant.light.brand);

    await userEvent.click(screen.getByText('legal'));
    await userEvent.click(screen.getByText('dark'));
    expect(root.dataset.niche).toBe('legal');
    expect(root.dataset.mode).toBe('dark');
    expect(root.style.getPropertyValue('--brand')).toBe(THEMES.legal.dark.brand);
  });

  it('remembers the choice, and survives storage that throws', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      render(
        <ThemeProvider initial={{ niche: 'general', preference: 'light' }}>
          <Probe />
        </ThemeProvider>,
      );
      await act(async () => {
        await userEvent.click(screen.getByText('legal'));
      });
      expect(screen.getByTestId('state')).toHaveTextContent('legal/light');
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('refuses to be used without a provider', () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
