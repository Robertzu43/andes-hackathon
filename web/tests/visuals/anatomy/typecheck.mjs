import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const foundation = resolve(process.argv[2] ?? 'web');
const require = createRequire(resolve(foundation, 'package.json'));
const ts = require('typescript');
const types = resolve(foundation, 'node_modules/@types/react');
const options = { target: ts.ScriptTarget.ES2023, lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, strict: true, noUncheckedIndexedAccess: true, noEmit: true,
  skipLibCheck: true, paths: { react: [resolve(types, 'index.d.ts')], 'react/jsx-runtime': [resolve(types, 'jsx-runtime.d.ts')] } };
const program = ts.createProgram([fileURLToPath(new URL('../../../src/visuals/anatomy/AnatomyRelay.tsx', import.meta.url))], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log(`React adapter strict typecheck passed; TypeScript ${ts.version}`);
