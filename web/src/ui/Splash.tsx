import { THEMES, type Niche } from '../theme/tokens';

/** Full-screen loading presentation: a core with two orbiting nodes. Decorative parts are hidden from assistive tech; the status text is not. */
export function Splash({
  niche,
  label = 'Preparing your workspace',
  leaving = false,
}: {
  niche: Niche;
  label?: string;
  leaving?: boolean;
}) {
  return (
    <div className="splash" role="status" aria-live="polite" data-leaving={leaving} data-testid="splash">
      <div className="splash-inner">
        <div className="orbit" aria-hidden="true">
          <span className="ring" />
          <span className="arm">
            <span className="node" />
          </span>
          <span className="arm">
            <span className="node" />
          </span>
          <span className="core">{THEMES[niche].label.charAt(0)}</span>
        </div>
        <div>
          <p style={{ fontWeight: 700 }}>{label}</p>
          <p className="muted">{THEMES[niche].tagline}</p>
        </div>
      </div>
    </div>
  );
}
