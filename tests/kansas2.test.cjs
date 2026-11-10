// Not Kansas 2 ledger: a honeycomb for every level. Run: node tests/kansas2.test.cjs   (seconds)
'use strict';
const CM = require('../core.js');
const results = [];
function ok(name, cond, detail) { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rndBall = (seed, hmax) => { const u = (j) => CM.rnd(seed, j); const d = [u(1) - 0.5, u(2) - 0.5, u(3) - 0.5], n = Math.hypot(...d), r = Math.tanh(0.5 * hmax * u(4)); return d.map((t) => t / n * r); };
const HS = CM.HONEYS;

// N1: the four mirrors satisfy the relations of the Coxeter group [p,q,r]
{
  let worst = 0; const rows = [];
  for (const H of HS) {
    const m = [[0, 1, H.p], [1, 2, H.q], [2, 3, H.r], [0, 2, 2], [0, 3, 2], [1, 3, 2]];
    let w = 0;
    for (const [i, j, n] of m) for (let t = 0; t < 40; t++) {
      const x0 = rndBall(1000 + t, 3); let x = x0;
      for (let s = 0; s < n; s++) x = CM.mirror(H, i, CM.mirror(H, j, x));
      w = Math.max(w, 2 * Math.hypot(x[0] - x0[0], x[1] - x0[1], x[2] - x0[2]) / (1 - dot(x0, x0)));   // displacement in hyperbolic length
      // and no smaller power is the identity
      if (n > 2) { let y = x0; for (let s = 0; s < n - 1; s++) y = CM.mirror(H, i, CM.mirror(H, j, y)); if (CM.hypDist(y, x0) < 1e-3 && Math.hypot(...x0) > 0.2) w = 1; }
    }
    worst = Math.max(worst, w); rows.push(`${H.symbol} ${w.toExponential(0)}`);
  }
  ok('N1 each honeycomb\'s four mirrors obey the Coxeter relations (m0m1)^p = (m1m2)^q = (m2m3)^r = (m0m2)² = (m0m3)² = (m1m3)² = 1', worst < 1e-5,
    `largest hyperbolic distance a point is moved by a relation, 40 points per relation: ${rows.join(', ')}`);
}
// N2: the face meets the wall at right angles; r cells fit round an edge; vertices inside the ball for the first four, on the wall for the next four
{
  let good = true; const rows = [];
  HS.forEach((H, i) => {
    // neighbouring face = this face reflected in m2; the angle of the region outside both spheres, measured where they meet
    const C2 = CM.mirror(H, 2, H.C), D = Math.hypot(C2[0] - H.C[0], C2[1] - H.C[1], C2[2] - H.C[2]);
    const dih = Math.acos((D * D - 2 * H.rho2) / (2 * H.rho2)) * 180 / Math.PI;
    const orth = Math.abs(H.c * H.c - 1 - H.rho2);
    const kindOk = H.kind === (i < 4 ? 'compact' : 'ideal');
    const vOn = H.vertex ? Math.abs(Math.hypot(H.vertex[0], H.vertex[1], H.vertex[2] - H.c) - H.rho) : 0;
    if (orth > 1e-12 || Math.abs(dih - 360 / H.r) > 1e-8 || !kindOk || vOn > 1e-12) good = false;
    rows.push(`${H.symbol} ${dih.toFixed(6)}° ${H.kind}`);
  });
  const H0 = HS[0];
  const reg = Math.abs(H0.inradius - 0.5306375309525179) < 1e-9 && Math.abs(H0.circumradius - 1.2264568712514068) < 1e-9 && Math.abs(H0.rho2 - (1 + Math.sqrt(5))) < 1e-12;
  ok('N2 every face meets the wall at right angles, the dihedral angle is 360°/r, corners are inside the ball (levels 0–3) or on the wall (4–7); {4,3,5} has Not Kansas\'s numbers',
    good && reg, rows.join(', ') + `; {4,3,5}: ρ² = ${H0.rho2.toFixed(10)}, inradius ${H0.inradius.toFixed(10)}, circumradius ${H0.circumradius.toFixed(10)}`);
}
// N3: duality. {p,q,r} and {r,q,p} swap cell centres with vertices: the inradius of one is half the edge of the other, circumradii agree
{
  const A = HS[0], B = HS[1], I = HS[2], Dd = HS[3];
  const e = Math.max(Math.abs(A.inradius - B.halfEdge), Math.abs(B.inradius - A.halfEdge), Math.abs(A.circumradius - B.circumradius), Math.abs(A.midradius - CM.hypDist(B.vertex, [0, 0, B.c - B.rho])), Math.abs(I.inradius - I.halfEdge), Math.abs(Dd.inradius - Dd.halfEdge));
  ok('N3 duality: level 0 and level 1 are duals ({4,3,5} ↔ {5,3,4}), levels 2 and 3 are their own duals', e < 1e-9,
    `inradius {5,3,4} ${B.inradius.toFixed(9)} = half edge {4,3,5} ${A.halfEdge.toFixed(9)}; inradius {4,3,5} ${A.inradius.toFixed(9)} = half edge {5,3,4} ${B.halfEdge.toFixed(9)}; both circumradii ${A.circumradius.toFixed(9)}; {3,5,3}: inradius = half edge = ${I.inradius.toFixed(9)}; {5,3,5}: ${Dd.inradius.toFixed(9)}; largest mismatch ${e.toExponential(1)}`);
}
// N4: the fold. Every point the renderer can reach (r < 0.985) lands in the chamber within the shader's 40 passes, and the fold keeps distances
{
  let good = true; const rows = [];
  for (const H of HS) {
    let out = 0, undone = 0, maxPass = 0, maxK = 0, worst = 0, n = 0;
    for (let t = 0; t < 4000; t++) {
      const a = rndBall(7000 + t, 4.86), r2 = dot(a, a);
      const b = a.map((v, j) => v + 1e-4 * (1 - r2) * (CM.rnd(t, 9 + j) - 0.5));
      const A = CM.foldH(H, a), B = CM.foldH(H, b), p = A.p;
      if (!A.done) undone++;
      maxPass = Math.max(maxPass, A.passes); maxK = Math.max(maxK, A.k);
      const inCh = p[0] >= -1e-12 && dot(p, H.n1) >= -1e-9 && dot(p, H.n2) >= -1e-9 && Math.hypot(p[0], p[1], p[2] - H.c) >= H.rho - 1e-9;
      if (A.done && !inCh) out++;
      const marg = Math.min(p[0], dot(p, H.n1), dot(p, H.n2), Math.hypot(p[0], p[1], p[2] - H.c) - H.rho);
      if (A.done && B.done && A.k === B.k && marg > 2e-3) { worst = Math.max(worst, Math.abs(CM.hypDist(A.p, B.p) - CM.hypDist(a, b)) / CM.hypDist(a, b)); n++; }
    }
    if (out || worst > 1e-5 || (H.kind === 'compact' ? undone > 0 || maxPass > 20 : undone > 20)) good = false;
    rows.push(`${H.symbol}: ${maxPass} passes, ${maxK} faces, ${undone} unfinished, distance change ${worst.toExponential(0)} (${n} pairs)`);
  }
  ok('N4 fold: of 4000 points per honeycomb out to hyperbolic radius 4.86 (r = 0.985, where the renderer stops), every one lands in the chamber within 20 passes when the cells are finite; with corners at infinity at most 0.5% are still unfinished after the shader\'s 40 passes (they sit in the cusps); nearby pairs keep their distance', good, rows.join('; '));
}
// N5: the strut formula is the true distance to the cell's edge
{
  let worst = 0;
  for (const H of HS) {
    // the edge is the circle where the plane m2 cuts the face sphere
    const k = dot(H.C, H.n2), O = H.C.map((v, j) => v - k * H.n2[j]), R = Math.sqrt(H.rho2 - k * k);
    const e1 = [1, 0, 0], e2 = [H.n2[1] * e1[2] - H.n2[2] * e1[1], H.n2[2] * e1[0] - H.n2[0] * e1[2], H.n2[0] * e1[1] - H.n2[1] * e1[0]];
    const pts = [];
    for (let i = 0; i < 200000; i++) { const t = 2 * Math.PI * i / 200000, q = O.map((v, j) => v + R * (Math.cos(t) * e1[j] + Math.sin(t) * e2[j])); if (dot(q, q) < 0.999999) pts.push(q); }
    for (let t = 0; t < 30; t++) {
      const p = CM.foldH(H, rndBall(300 + t, 2.5)).p;
      let best = Infinity; for (const q of pts) best = Math.min(best, CM.hypDist(p, q));
      worst = Math.max(worst, Math.abs(best - Math.asinh(CM.edgeSinh(H, p))));
    }
  }
  ok('N5 struts: sinh d = √(s2² + s3² + 2 s2 s3 cos π/r) / sin π/r equals the distance to the edge found by brute force', worst < 2e-4, `30 points × 8 honeycombs: largest difference ${worst.toExponential(1)} (the brute-force search has 200 000 points on the edge circle)`);
}
// N6: the levels go round, and the pearl fits inside its cell
{
  const round = CM.honeyOf(8) === CM.honeyOf(0) && CM.honeyOf(11) === HS[3];
  const fits = HS.every((H) => 2 * Math.atanh(H.orb) < 0.25 * H.inradius);
  ok('N6 eight honeycombs, then round again; the pearl at each cell\'s centre has hyperbolic radius 0.24 × the inradius', round && fits, HS.map((H) => `${H.symbol} ${(2 * Math.atanh(H.orb)).toFixed(3)}`).join(', '));
}
console.log(`\n${results.filter(Boolean).length}/${results.length} pass`);
if (results.some((r) => !r)) process.exit(1);
