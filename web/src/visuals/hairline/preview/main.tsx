import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneIllustration } from '../PhoneIllustration';
import './preview.css';

const copy = {
  es: {
    demo: 'Demostración local', language: 'Idioma', heading: 'Tu teléfono',
    introduction: 'Prepara ANDES con el vehículo detenido.',
    label: 'Ilustración de un teléfono con pantalla, placa, batería y carcasa separadas.',
    caption: 'Con la página cerrada o la pantalla bloqueada, el navegador puede dejar de enviar datos.',
    detail: 'Las capas del teléfono son una ilustración. Los permisos y las limitaciones del navegador se consultan por separado.',
    enable: 'Explorar la ilustración', disable: 'Dejar la ilustración quieta',
    range: 'Separación de las capas', reduced: 'La ilustración permanece quieta según tu preferencia de movimiento.',
    interaction: 'Mueve el puntero sobre el teléfono o ajusta la separación. En una pantalla táctil puedes tocar la ilustración.',
    controls: 'Controles de la ilustración',
  },
  'pt-BR': {
    demo: 'Demonstração local', language: 'Idioma', heading: 'Seu telefone',
    introduction: 'Prepare o ANDES com o veículo parado.',
    label: 'Ilustração de um telefone com tela, placa, bateria e carcaça separadas.',
    caption: 'Com a página fechada ou a tela bloqueada, o navegador pode parar de enviar dados.',
    detail: 'As camadas do telefone são uma ilustração. As permissões e as limitações do navegador são consultadas separadamente.',
    enable: 'Explorar a ilustração', disable: 'Deixar a ilustração parada',
    range: 'Separação das camadas', reduced: 'A ilustração permanece parada conforme sua preferência de movimento.',
    interaction: 'Mova o ponteiro sobre o telefone ou ajuste a separação. Em uma tela sensível ao toque, você pode tocar a ilustração.',
    controls: 'Controles da ilustração',
  },
};

function Preview() {
  const [locale, setLocale] = useState<'es' | 'pt-BR'>('es');
  const [motion, setMotion] = useState(false);
  const [spread, setSpread] = useState(0.5);
  const [reduced, setReduced] = useState(true);
  const t = copy[locale];
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${t.heading} | ANDES`;
  }, [locale, t.heading]);

  return <>
    <header className="preview-header">
      <span className="preview-brand">ANDES</span>
      <span className="preview-demo">{t.demo}</span>
      <label className="preview-language">{t.language}
        <select value={locale} onChange={e => setLocale(e.target.value as 'es' | 'pt-BR')}>
          <option value="es" lang="es">Español</option>
          <option value="pt-BR" lang="pt-BR">Português (Brasil)</option>
        </select>
      </label>
    </header>
    <main className="preview-main">
      <h1>{t.heading}</h1>
      <p className="preview-introduction">{t.introduction}</p>
      <section aria-label={t.heading}>
        <PhoneIllustration label={t.label} caption={t.caption}
          motion={motion ? 'interactive' : 'still'} spread={spread} />
        <p className="preview-detail">{t.detail}</p>
      </section>
      <section className="preview-controls" aria-label={t.controls}>
        <button type="button" disabled={reduced} aria-pressed={motion && !reduced}
          onClick={() => setMotion(v => !v)}>{motion && !reduced ? t.disable : t.enable}</button>
        {reduced ? <p>{t.reduced}</p> : <p>{t.interaction}</p>}
        <label className="preview-range">{t.range}
          <input type="range" min="0" max="1" step="0.5" value={spread}
            onChange={e => setSpread(e.target.valueAsNumber)} />
        </label>
      </section>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
