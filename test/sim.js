/* Simulation d'équilibrage : node test/sim.js [combats par niveau] */
const E = require('../public/engine.js');
let id = 0; const nm = () => 'b' + (id++) + 'x' + Math.random().toString(36).slice(2, 7);
const N = +process.argv[2] || 4000, only = process.argv[3];
for (const L of [3, 6, 10, 15]) {
  const perk = {}, turns = [];
  const add = (k, w) => { perk[k] ??= [0, 0]; perk[k][0] += w; perk[k][1]++; };
  for (let i = 0; i < N; i++) {
    const A = E.npc(nm(), L), B = E.npc(nm(), L), { win, turns: t } = E.simulate(A, B); turns.push(t);
    for (const [b, w] of [[A, win === 0], [B, win === 1]]) [...new Set(b.pets)].forEach(k => add('P:' + k, w));
  }
  turns.sort((a, b) => a - b);
  const fmt = o => Object.entries(o).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([k, [w, n]]) => `${k} ${(100 * w / n).toFixed(0)}%(${n})`).join('  ');
  console.log(`\n== Niveau ${L} | actions médianes ${turns[turns.length >> 1]}`); console.log(fmt(perk));
}
