import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneIllustration } from './PhoneIllustration';

type Motion = 'still' | 'interactive';
interface MountOptions { locale: 'es' | 'pt-BR'; motion: Motion; signal: AbortSignal }

const copy = {
  es: {
    label: 'Ilustración de un teléfono con pantalla, placa, batería y carcasa separadas.',
    range: 'Separación de las capas',
  },
  'pt-BR': {
    label: 'Ilustração de um telefone com tela, placa, bateria e carcaça separadas.',
    range: 'Separação das camadas',
  },
};

function MountedPhone({ locale, motion }: Omit<MountOptions, 'signal'>) {
  const [spread, setSpread] = useState(0.5);
  const t = copy[locale];
  return <div className="andes-phone-mount" lang={locale}>
    <PhoneIllustration label={t.label} motion={motion} spread={spread} />
    <label className="andes-phone-mount__range">{t.range}
      <input type="range" min="0" max="1" step="0.5" value={spread}
        onChange={event => setSpread(event.target.valueAsNumber)} />
    </label>
  </div>;
}

/** Bridge for component55's host. The host owns captions and its motion button. */
export function mountVisual(host: HTMLElement, options: MountOptions) {
  if (options.signal.aborted) return { setMotion(_motion: Motion) {}, destroy() {} };
  const container = document.createElement('div');
  host.append(container);
  const root = createRoot(container);
  let dead = false;
  const setMotion = (motion: Motion) => {
    if (!dead) root.render(<MountedPhone locale={options.locale} motion={motion} />);
  };
  const destroy = () => {
    if (dead) return;
    dead = true;
    options.signal.removeEventListener('abort', destroy);
    root.unmount();
    container.remove();
  };
  options.signal.addEventListener('abort', destroy, { once: true });
  setMotion(options.motion);
  return { setMotion, destroy };
}
