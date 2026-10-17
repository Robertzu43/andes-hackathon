// Build-time only. Anatomy MIT kit; see vendor/LICENSE and docs/visuals/anatomy.md.
import * as k from './vendor/iso-kit.mjs';
import * as A from './vendor/audit.mjs';

export const WIDTH = 640, HEIGHT = 360;
const BASE = { x: -142, y: -63, w: 284, d: 126, r: 10 };
export const P = k.fitProjection([...k.boxCorners(BASE, -17, 0), [90, -17, 99]], WIDTH, HEIGHT,
  { pad: 35, azimuth: 53, elevation: 32 });
export const MOVES = { fixed: [0, 0, 0], dispatch: [0, 0, 5], carriage: [36, 0, 0], flag: [0, 0, 18] };
export const R = A.recorder(P);

function slab(name, plan, z, h, { tone = 'mid', piece = 'fixed', inner = '' } = {}) {
  const shape = R.solid(A.slab(plan, z, h, { name, owner: piece === 'fixed' ? name : piece }, 4));
  const svg = k.solidSvg(k.slabOf(plan, z, h, P, 4, Math.min(.7, h / 4)), { tone, inner });
  return R.put({ name, piece, move: MOVES[piece], at: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], svg, shapes: [shape] });
}
function bolt(name, x, y, z, piece = 'fixed') {
  const shape = R.solid(A.cylinder(x, y, 1.65, z, 1.2, { name, owner: piece === 'fixed' ? name : piece }));
  const svg = k.solidSvg(k.cylinder(x, y, 1.65, z, 1.2, P, 24), { tone: 'hi',
    inner: k.lineSvg(k.lineOnTop([x - 1.65, y], [x + 1.65, y], z + 1.2, P), { tone: 'lo' }) });
  R.put({ name, piece, move: MOVES[piece], at: [x, y, z + .6], svg, shapes: [shape] });
}

// Concept: one dispatch plunger moves the acceptance carriage; the independent
// flag rises only in the deliberately selected acknowledged example.
// Parts list: 8 feet, deck, 4 deck bolts; 2 mounts, 12 relay laminations,
// 2 caps, 4 cap bolts; 2 rails, 4 rail bolts, 4 stops; carriage, 2 bearing
// shoes, message plate, 4 message bolts; pedestal, 2 guides, plunger,
// paddle, 2 pedestal bolts; mast foot, mast, 2 bolts, flag and 2 flag bolts;
// nameplate and 2 rivets. Every item below has a true recorded solid.
for (const [i, [x, y]] of k.corners(BASE, 19).entries()) {
  slab(`stand.foot-pad.${i}`, { x: x - 7, y: y - 7, w: 14, d: 14, r: 3 }, -17, 3, { tone: 'lo' });
  slab(`stand.foot.${i}`, { x: x - 5, y: y - 5, w: 10, d: 10, r: 2 }, -14, 4);
}
slab('stand.deck', BASE, -10, 10, { tone: 'lo', inner: k.lineSvg(k.sideSeam(BASE, -4, P, 4), { tone: 'faint' }) });
for (const [i, [x, y]] of k.corners(BASE, 10).entries()) bolt(`deck-bolt.${i}`, x, y, 0);

for (const [i, x] of [-42, 2].entries()) {
  slab(`relay-mount.${i}`, { x, y: -49, w: 30, d: 25, r: 3 }, 0, 4);
  for (let j = 0; j < 6; j++) slab(`relay-lamination.${i}.${j}`, { x: x + 3, y: -46, w: 24, d: 19, r: 2 }, 4 + j * 3, 3, { tone: j % 2 ? 'lo' : 'mid' });
  slab(`relay-cap.${i}`, { x, y: -49, w: 30, d: 25, r: 3 }, 22, 3, { tone: 'hi' });
  bolt(`relay-cap-bolt.${i}.0`, x + 4, -45, 25);
  bolt(`relay-cap-bolt.${i}.1`, x + 26, -28, 25);
}
for (const [i, y] of [-12, 18].entries()) {
  slab(`rail.${i}`, { x: -49, y, w: 110, d: 6, r: 1 }, 0, 5);
  for (const [j, x] of [-44, 56].entries()) bolt(`rail-bolt.${i}.${j}`, x, y + 3, 5);
  for (const [j, x] of [-56, 61].entries()) slab(`stop.${i}.${j}`, { x, y: y - 2, w: 7, d: 10, r: 1 }, 0, 8);
}
slab('carriage.bed', { x: -32, y: -12, w: 36, d: 36, r: 3 }, 5, 4, { piece: 'carriage', tone: 'hi' });
for (const [i, y] of [-12, 19].entries()) slab(`carriage.shoe.${i}`, { x: -30, y, w: 32, d: 5, r: 1 }, 9, 3, { piece: 'carriage' });
slab('carriage.message', { x: -28, y: -3, w: 28, d: 18, r: 2 }, 9, 1, { piece: 'carriage', tone: 'hi',
  inner: k.lineSvg(k.planOutline({ x: -25, y: 0, w: 22, d: 12, r: 1 }, 10, P, 4), { tone: 'lo' }) });
for (const [i, [x, y]] of k.corners({ x: -28, y: -3, w: 28, d: 18, r: 2 }, 2).entries()) bolt(`carriage.message-bolt.${i}`, x, y, 10, 'carriage');

slab('dispatch.pedestal', { x: -112, y: 6, w: 42, d: 36, r: 4 }, 0, 12);
for (const [i, y] of [7, 33].entries()) slab(`dispatch.guide.${i}`, { x: -102, y, w: 22, d: 8, r: 2 }, 12, 12);
// The plunger remains in contact with the two guide faces over its whole stroke.
slab('dispatch.plunger', { x: -100, y: 15, w: 18, d: 18, r: 0 }, 12, 15, { piece: 'dispatch' });
slab('dispatch.paddle', { x: -106, y: 11, w: 30, d: 26, r: 4 }, 27, 4, { piece: 'dispatch', tone: 'hi',
  inner: k.lineSvg(k.planOutline({ x: -102, y: 15, w: 22, d: 18, r: 2 }, 31, P, 4), { tone: 'lo' }) });
bolt('dispatch.bolt.0', -108, 10, 12); bolt('dispatch.bolt.1', -74, 38, 12);

slab('receipt.foot', { x: 77, y: -28, w: 22, d: 22, r: 3 }, 0, 5);
slab('receipt.mast', { x: 86, y: -19, w: 4, d: 4, r: 0 }, 5, 91);
bolt('receipt.base-bolt.0', 80, -25, 5); bolt('receipt.base-bolt.1', 96, -9, 5);
slab('receipt.flag', { x: 90, y: -19, w: 31, d: 4, r: 0 }, 48, 19, { piece: 'flag', tone: 'hi' });
bolt('receipt.flag-bolt.0', 94, -17, 67, 'flag'); bolt('receipt.flag-bolt.1', 117, -17, 67, 'flag');

slab('nameplate', { x: -16, y: 40, w: 58, d: 12, r: 2 }, 0, .8, { tone: 'mid',
  inner: k.faceTextSvg(k.topMatrix([13, 48], .8, P), 'ANDES', { size: 5, anchor: 'middle', tone: 'mid' }) });
bolt('nameplate.rivet.0', -12, 46, .8); bolt('nameplate.rivet.1', 38, 46, .8);

// Verify continuous interpolation of every visible mechanism, including the
// independently raised flag. Both acceptance examples intentionally share art.
export const STATES = [];
for (const flag of [0, 1]) for (let i = 0; i <= 10; i++) STATES.push({ label: `accept-${i}-flag-${flag}`,
  shares: { fixed: 0, dispatch: i / 10, carriage: i / 10, flag } });
for (let i = 0; i <= 10; i++) STATES.push({ label: `flag-${i}`, shares: { fixed: 0, dispatch: 1, carriage: 1, flag: i / 10 } });

export function buildGeometry() {
  A.settle(R, P, { states: STATES, step: .8 });
  const items = [...R.items].sort((a, b) => a.key - b.key);
  const body = items.map(item => `<g data-relay-part="${item.name}" data-relay-motion="${item.piece}">${item.svg}</g>`).join('');
  return { body, parts: items.length, projection: P,
    order: items.map(item => ({ name: item.name, piece: item.piece, key: item.key, lift: k.depthOf(item.move, P) })),
    vectors: Object.fromEntries(Object.entries(MOVES).map(([name, v]) => {
      const origin = k.iso([0, 0, 0], P), to = k.iso(v, P);
      return [name, [to[0] - origin[0], to[1] - origin[1]]];
    })) };
}

export function auditGeometry() {
  return A.auditOrExit(R, P, { argv: ['--audit'], frames: STATES, apart: false });
}
