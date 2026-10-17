import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import './phone.css';

const PhoneCanvas = lazy(() => import('./PhoneCanvas'));
const restImages = [
  new URL('./phone-rest-compact.svg', import.meta.url).href,
  new URL('./phone-rest.svg', import.meta.url).href,
  new URL('./phone-rest-open.svg', import.meta.url).href,
];

export interface PhoneIllustrationProps {
  /** Supply the selected es / pt-BR description. Never pass a trip status. */
  label: string;
  /** This text remains visible if the optional drawing cannot load. */
  caption?: ReactNode;
  /** The host enables this only after a named, explicit parked-use action. */
  motion?: 'still' | 'interactive';
  /** Decorative layer separation, 0..1. Suitable for a labelled native range. */
  spread?: number;
  className?: string;
}

class DrawingBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Optional artwork only. Does not request permissions, observe a trip or send data. */
export function PhoneIllustration({
  label, caption, motion = 'still', spread = 0.5, className = '',
}: PhoneIllustrationProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [permitted, setPermitted] = useState(false);

  useEffect(() => {
    const node = frame.current;
    // Fail to the useful still image in older browsers and during SSR.
    if (!node || !('IntersectionObserver' in window) || !window.matchMedia) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;
    const update = () => setPermitted(inView && !document.hidden && !reduced.matches);
    const observer = new IntersectionObserver(entries => {
      const entry = entries.filter(item => item.target === node).at(-1);
      if (!entry) return;
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(node);
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
    };
  }, []);

  const interactive = motion === 'interactive' && permitted;
  const intensity = Number.isFinite(spread) ? Math.max(0, Math.min(1, spread)) : 0.5;
  const restImage = restImages[Math.round(intensity * 2)];

  return (
    <figure className={`andes-phone ${className}`}>
      <div ref={frame} className="andes-phone__frame" role="img" aria-label={label}>
        <img className="andes-phone__still" src={restImage} width="400" height="320"
          loading="lazy" decoding="async" alt="" aria-hidden="true" />
        {interactive && (
          <DrawingBoundary>
            <Suspense fallback={null}>
              <PhoneCanvas label={label} intensity={intensity} />
            </Suspense>
          </DrawingBoundary>
        )}
      </div>
      {caption != null && <figcaption className="andes-phone__caption">{caption}</figcaption>}
    </figure>
  );
}
