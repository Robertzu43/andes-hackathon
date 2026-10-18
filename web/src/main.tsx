import { createRoot } from 'react-dom/client';
import { FoundationRoot } from './foundation/index.ts';
import type { FoundationOptions } from './foundation/index.ts';
import './styles/tokens.css';
import './styles/foundation.css';

const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');
const root = createRoot(element);
root.render(<FoundationRoot />);
// Explicit local test builds may inject a token-free UI gateway. Never in production.
if (__ANDES_TEST_HOOKS__) {
  window.__ANDES_TEST_MOUNT__ = options => root.render(<FoundationRoot {...options} />);
}
declare global { interface Window { __ANDES_TEST_MOUNT__?: (options: FoundationOptions) => void } }
