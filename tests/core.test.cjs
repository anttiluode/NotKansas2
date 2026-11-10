// CrystalMoon V2 ledger. Run: node tests/core.test.cjs   (a few minutes)
'use strict';
const CM = require('../core.js');

const results = [];
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
/** A test law: level 0 with overrides, re-derived. Islands are cleared; tests write ε themselves. */
function testLaw(over = {}) {
  const L = CM.derive({ ...CM.law(0), ...over });
  return L;
}
function frac(f, arr, pred, thr = 0.3) {
  let a = 0, c = 0;
  for (let z = 0; z < f.n; z++) for (let y = 0; y < f.n; y++) for (let x = 0; x < f.n; x++) {
    if (!pred(x, y, z)) continue; c++;
    if (Math.abs(arr[f.idx(x, y, z)]) > thr) a++;
  }
  return a / Math.max(1, c);
}
function maxAbs(a) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; }
function spectrumPeak(f, arr, mmax) {
  const n = f.n, shell = new Float64Array(mmax + 2);
  const cs = [], sn = [];
  for (let m = -mmax; m <= mmax; m++) { const c = [], s = []; for (let x = 0; x < n; x++) { c.push(Math.cos(2 * Math.PI * m * x / n)); s.push(Math.sin(2 * Math.PI * m * x / n)); } cs[m + mmax] = c; sn[m + mmax] = s; }
  for (let mx = 0; mx <= mmax; mx++) for (let my = -mmax; my <= mmax; my++) for (let mz = -mmax; mz <= mmax; mz++) {
    const r = Math.hypot(mx, my, mz);
    if (r > mmax + 0.5 || r === 0) continue;
    let re = 0, im = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) {
      const cyz = cs[my + mmax][y] * cs[mz + mmax][z] - sn[my + mmax][y] * sn[mz + mmax][z];
      const syz = sn[my + mmax][y] * cs[mz + mmax][z] + cs[my + mmax][y] * sn[mz + mmax][z];
      const base = (z * n + y) * n;
      for (let x = 0; x < n; x++) {
        const p = arr[base + x];
        re += p * (cs[mx + mmax][x] * cyz - sn[mx + mmax][x] * syz); im -= p * (sn[mx + mmax][x] * cyz + cs[mx + mmax][x] * syz);
      }
    }
    shell[Math.round(r)] += re * re + im * im;
  }
  return { peak: shell.indexOf(Math.max(...shell)), shell };
}

// ------------------------------------------------------------------ T1 laws
{
  const a = CM.law(3), b = CM.law(3), c = CM.law(4);
  let worst = 0;
  for (let k = 0; k < 60; k++) {
    const L = CM.law(k);
    for (const q2 of [L.qc2, L.qf2]) worst = Math.max(worst, L.dt * Math.max(Math.pow(12 - q2, 2), q2 * q2));
  }
  ok('T1 one law per level, the same every visit; the explicit step is inside the stability bound for both fields',
    JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c) && worst < 2,
    `level 3: ${a.name}, λc ${a.lamC.toFixed(1)}, λf ${a.lamF.toFixed(1)}; worst dt·|op| over 60 levels = ${worst.toFixed(2)} (< 2)`);
}

// ---------------------------------------------- T2 bounded under the strongest law
{
  const L = testLaw({ lamC: 8, gC: 1.3, lamF: 4.2, gF: 1.3, epsIsland: 0.34, epsF: 0.38, kfb: 0.2, kL: 0.45 });
  const f = new CM.Field(L, 28);
  f.eps.fill(0.34); f.light.fill(1); f.mask.fill(1); f.seedNoise(0.3, 9);
  for (let s = 0; s < 1500; s++) f.step();
  const m = Math.max(maxAbs(f.psi), maxAbs(f.phi));
  ok('T2 strongest growth, feedback and light: bounded, no NaN', Number.isFinite(m) && m < 3, `max |ψ|,|φ| = ${m.toFixed(2)}`);
}

// ------------------------------- T3 the fine lattice lives only inside the coarse body
{
  const L = testLaw({ kL: 0 }), n = 40;
  const f = new CM.Field(L, n);
  const isl = (x) => x >= 13 && x < 27;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f.eps[f.idx(x, y, z)] = isl(x) ? 0.26 : L.epsSea;
  f.seedNoise(0.05, 7);
  for (let s = 0; s < 4500; s++) f.step();
  let inC = 0, inN = 0, outC = 0, outN = 0;
  for (let i = 0; i < f.psi.length; i++) {
    const fine = Math.abs(f.phi[i]) > 0.3;
    if (f.psi[i] > 0.4) { inN++; inC += fine; } else if (f.psi[i] < 0.0) { outN++; outC += fine; }
  }
  const fin = inC / inN, fout = outC / outN, sea = frac(f, f.phi, (x) => x < 5 || x >= 35, 0.3);
  ok('T3 two scales: the fine lattice grows inside the coarse body and nowhere else',
    fin > 0.3 && fout < 0.1 && sea === 0,
    `fine crystal in ${(100 * fin).toFixed(0)}% of voxels where ψ > 0.4, ${(100 * fout).toFixed(0)}% where ψ < 0; fine crystal in the far sea ${(100 * sea).toFixed(0)}%`);
}

// ------------------------------------- T4 each field keeps its own wavelength
{
  const n = 36, L = testLaw({ lamC: 9, lamF: 4.5, kL: 0, kfb: 0 });
  const f = new CM.Field(L, n);
  f.eps.fill(0.26); f.seedNoise(0.05, 11);
  for (let s = 0; s < 4500; s++) f.step();
  const c = spectrumPeak(f, f.psi, 9), d = spectrumPeak(f, f.phi, 9);
  ok('T4 the Mexican hats pick two wavelengths: ψ peaks at |m| = n/λc, φ at n/λf',
    c.peak === n / 9 && d.peak === n / 4.5, `ψ peak |m| = ${c.peak} (expect ${n / 9}), φ peak |m| = ${d.peak} (expect ${n / 4.5})`);
}

// -------------------------------- T5 the fine crystal feeds back on the coarse one
{
  const run = (kfb) => {
    const L = testLaw({ kfb, kL: 0, lamC: 8, lamF: 4.8 }), n = 24, f = new CM.Field(L, n);
    f.eps.fill(0.26); f.seedNoise(0.05, 5);
    for (let s = 0; s < 8000; s++) f.step();
    let s2 = 0; for (const v of f.psi) s2 += v * v;
    return Math.sqrt(s2 / f.psi.length);
  };
  const neg = run(-0.4), zero = run(0), pos = run(0.4);
  ok('T5 feedback: fine crystal with k_fb > 0 thickens the coarse body, with k_fb < 0 eats it',
    pos > 1.03 * zero && zero > 1.03 * neg, `rms coarse amplitude: k_fb −0.4 → ${neg.toFixed(3)}, 0 → ${zero.toFixed(3)}, +0.4 → ${pos.toFixed(3)}`);
}

// -------------------------------------------------------- T6 crystal casts shadows
{
  const N = CM.N, Psi = new Float32Array(N * N * N), c = CM.MOON.c;
  // a ball of crystal radius 4 between the moon (z = 32) and the point (32, 32, 6)
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    Psi[(z * N + y) * N + x] = Math.hypot(x - 32, y - 32, z - 17) < 4 ? 1.5 : 0;
  const occ = CM.occupancy(Psi, 0.6, 1);
  const behind = CM.lightAt(occ, 32, 32, 6);
  // the same distance from the moon, rotated off the shadow axis
  const d = 26, th = 0.6, side = CM.lightAt(occ, 32 + d * Math.sin(th), 32, 32 - d * Math.cos(th));
  const front = CM.lightAt(occ, 32, 32, 21.5);
  ok('T6 moonlight: a crystal ball casts a shadow behind itself; the side and the near face stay lit',
    behind < 0.05 * side && front > 0.5 * side, `light behind ${behind.toFixed(4)}, beside ${side.toFixed(3)}, between ball and moon ${front.toFixed(3)}`);
}

// --------------------------------------------- T7 moonlight writes where crystal lives
{
  const L = testLaw({ kL: 0.5, epsIsland: -0.2 }), n = 48;
  const f = new CM.Field(L, n);
  f.eps.fill(-0.2); f.mask.fill(1);
  const lit = (x) => x < 16;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f.light[f.idx(x, y, z)] = lit(x) ? 1 : 0;
  f.seedNoise(0.05, 21);
  for (let s = 0; s < 3000; s++) f.step();
  const a = frac(f, f.psi, (x) => x >= 3 && x < 13), b = frac(f, f.psi, (x) => x >= 26 && x < 38, 0.05);
  ok('T7 light is a growth term: with the same ε (−0.2), the lit half crystallises and the shadowed half stays empty',
    a > 0.3 && b === 0, `crystal in lit half ${(100 * a).toFixed(0)}%, shadowed half |ψ| > 0.05 in ${(100 * b).toFixed(0)}%`);
}

// ----------------------------------------------- T8 portal and membrane identities
{
  const R = CM.MOON.R, c = CM.MOON.c;
  let inv = 0, rad = 0, conf = 0, rot = 0, glue = 0;
  for (let k = 0; k < 300; k++) {
    const u = (j) => CM.rnd(k, j);
    const x = [c[0] + 50 * (u(1) - 0.5), c[1] + 50 * (u(2) - 0.5), c[2] + 50 * (u(3) - 0.5)];
    const y = CM.portal(CM.portal(x));
    inv = Math.max(inv, Math.hypot(y[0] - x[0], y[1] - x[1], y[2] - x[2]));
    const rx = Math.hypot(x[0] - c[0], x[1] - c[1], x[2] - c[2]);
    const px = CM.portal(x);
    rad = Math.max(rad, Math.abs(Math.hypot(px[0] - c[0], px[1] - c[1], px[2] - c[2]) * rx - R * R));
    const J = CM.portalJacobian(x), l2 = (R * R / (rx * rx)) ** 2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let m = 0; m < 3; m++) s += J[i][m] * J[j][m]; conf = Math.max(conf, Math.abs(s - (i === j ? l2 : 0)) / l2); }
    const h = [(x[0] - c[0]) / rx, (x[1] - c[1]) / rx, (x[2] - c[2]) / rx];
    const Js = CM.portalJacobian([c[0] + R * h[0], c[1] + R * h[1], c[2] + R * h[2]]);
    const Jh = [0, 1, 2].map((i) => Js[i][0] * h[0] + Js[i][1] * h[1] + Js[i][2] * h[2]);
    rot = Math.max(rot, Math.hypot(Jh[0] - h[0], Jh[1] - h[1], Jh[2] - h[2]));
    // the membrane: Φ(I(x)) = 2c − x
    const g = CM.portal(CM.invert(x));
    glue = Math.max(glue, Math.hypot(g[0] - (2 * c[0] - x[0]), g[1] - (2 * c[1] - x[1]), g[2] - (2 * c[2] - x[2])));
  }
  let vox = 0;
  for (let k = 0; k < 500; k++) {
    const x = [Math.floor(64 * CM.rnd(k, 7)), Math.floor(64 * CM.rnd(k, 8)), Math.floor(64 * CM.rnd(k, 9))];
    const m = CM.mirrorVoxel(...x), e = x.map((v, i) => ((2 * c[i] - v) % 64 + 64) % 64);
    vox = Math.max(vox, Math.abs(m[0] - e[0]) + Math.abs(m[1] - e[1]) + Math.abs(m[2] - e[2]));
  }
  ok('T8 portal Φ: involution, |Φx−c|·|x−c| = R², conformal, half-turn on the moon; and the membrane Φ∘I is the point reflection 2c − x, exact on voxels',
    inv < 1e-9 && rad < 1e-9 && conf < 1e-9 && rot < 1e-9 && glue < 1e-9 && vox === 0,
    `errors: involution ${inv.toExponential(1)}, radius ${rad.toExponential(1)}, conformal ${conf.toExponential(1)}, half-turn ${rot.toExponential(1)}, Φ∘I vs 2c−x ${glue.toExponential(1)}, voxel mirror ${vox}`);
}

// ------------------------------------------------ T9 crystal grows through the moon
{
  const run = (glue) => {
    const n = 64, Lo = testLaw({ kL: 0, glue }), Li = testLaw({ kL: 0, glue, hue: 0.1 });
    const out = new CM.Field(Lo, n), inn = new CM.Field(Li, n);
    const c = CM.MOON.c, R = CM.MOON.R;
    // outer: an island pressed against the membrane on the +x side; inner: nothing but sea
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = out.idx(x, y, z), r = Math.hypot(x - c[0], y - c[1], z - c[2]);
      const isl = Math.hypot(x - (c[0] + R + 8), y - c[1], z - c[2]) < 11 && r > R - 1;
      out.eps[i] = isl ? 0.26 : Lo.epsSea; inn.eps[i] = Li.epsSea;
    }
    out.other = inn; inn.other = out; out.glue = glue; inn.glue = glue;
    out.seedNoise(0.05, 31); inn.seedNoise(0.05, 32);
    for (let s = 0; s < 4500; s++) { out.step(); inn.step(); }
    // the glued region on the other side: voxels within the band, mirrored from the island's footprint
    const mirrorRegion = (x, y, z) => { const r = Math.hypot(x - c[0], y - c[1], z - c[2]); return r > R - 0.5 && r < R + 3 && x < c[0] - 4; };
    let match = 0, cnt = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!mirrorRegion(x, y, z)) continue;
      const a = inn.psi[inn.idx(x, y, z)] + Li.beta * inn.phi[inn.idx(x, y, z)];
      const b = out.psi[out.idx(n - x, n - y, n - z)] + Lo.beta * out.phi[out.idx(n - x, n - y, n - z)];
      match += Math.abs(a - b); cnt++;
    }
    const innerCrystal = frac(inn, inn.psi, mirrorRegion, 0.1), farInner = frac(inn, inn.psi, (x) => x > c[0] + 4, 0.05);
    return { innerCrystal, farInner, mismatch: match / cnt };
  };
  const g = run(1), z = run(0);
  ok('T9 the membrane: an island touching the moon outside grows its continuation in the inner world (2c − x), and only there; without glue the inner side stays empty',
    g.innerCrystal > 0.2 && z.innerCrystal === 0 && g.farInner === 0 && g.mismatch < 0.15,
    `inner |ψ| > 0.1 at the mirror site: glued ${(100 * g.innerCrystal).toFixed(0)}%, unglued ${(100 * z.innerCrystal).toFixed(0)}%; inner far side |ψ|>0.05 ${(100 * g.farInner).toFixed(0)}%; mean |Ψ_in − Ψ_out(2c−x)| at the membrane ${g.mismatch.toFixed(3)}`);
}

// ---------------------------------------------- T12 bent moonlight: crystal guides light
{
  const N = CM.N, c = CM.MOON.c, Psi = new Float32Array(N * N * N);
  // a crystal rod, radius 2.5, standing out from the moon along +z
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (Math.hypot(x - c[0], y - c[1]) < 2.5 && z > c[2] + 10 && z < c[2] + 31) Psi[(z * N + y) * N + x] = 1.5;
  const at = (I, dx, dz) => I[((c[2] + dz) * N + c[1]) * N + c[0] + dx];
  const flat = CM.tracePhotons(Psi, 0.6, 1, 0, { K: 65536 }), bent = CM.tracePhotons(Psi, 0.6, 1, 0.8, { K: 65536 });
  ok('T12 photons through the lens: a crystal rod that casts a shadow with straight light becomes a light guide when light bends (κ = 0.8), and the space beside it goes darker',
    at(bent, 0, 24) > 10 * at(flat, 0, 24) && at(bent, 5, 24) < at(flat, 5, 24),
    `light inside the rod 24 voxels out: straight ${at(flat, 0, 24).toFixed(3)}, bent ${at(bent, 0, 24).toFixed(3)} (cap ${CM.PHOTON.cap}); 5 voxels beside it: straight ${at(flat, 5, 24).toFixed(3)}, bent ${at(bent, 5, 24).toFixed(3)}`);
}

// ------------------------------------------------------------- the camera (V1 behaviour kept)
const camImg = (fb, fd) => {
  const W = CM.CAM.W, H = CM.CAM.H, a = new Float32Array(2 * W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { a[2 * (y * W + x)] = fb(x / W, y / H); a[2 * (y * W + x) + 1] = fd(x / W, y / H); }
  return a;
};
function camRegions(f, inA, inB) {
  const P = f._camPlaces(), V = f.visible(); let a = 0, an = 0, b = 0, bn = 0;
  for (let i = 0; i < V.length; i++) {
    const k = P[i]; if (k.w <= 0.8) continue;
    const c = Math.abs(V[i]) > 0.3 ? 1 : 0;
    if (inA(k)) { a += c; an++; } else if (inB(k)) { b += c; bn++; }
  }
  return [a / an, b / bn];
}
{
  const L = testLaw({ kL: 0 }), f = new CM.Field(L, 64);
  f.eps.fill(L.epsSea); f.seedNoise(0.2, 3);
  f.setCamera({ img: camImg((u) => (u < 0.5 ? 1 : 0), () => 0), mode: 1, gain: 1, motion: 1 });
  for (let s = 0; s < 3500; s++) f.step();
  const [b1, d1] = camRegions(f, (k) => k.u < 0.4, (k) => k.u > 0.6);
  const fineIn = (() => { const P = f._camPlaces(); let a = 0, c = 0; for (let i = 0; i < f.phi.length; i++) { const k = P[i]; if (k.w > 0.8 && k.u < 0.4) { c++; a += Math.abs(f.phi[i]) > 0.3; } } return a / c; })();
  ok('T10 camera brightness gates both fields: the bright half crystallises (with its fine lattice), the dark half stays empty',
    b1 > 0.4 && d1 < 0.02 && fineIn > 0.2, `visible crystal bright ${b1.toFixed(2)}, dark ${d1.toFixed(2)}; fine lattice in bright half ${fineIn.toFixed(2)}`);
}
{
  const L = testLaw({ kL: 0 }), f = new CM.Field(L, 64);
  f.eps.fill(L.epsSea); f.seedNoise(0.2, 3);
  const disc = (k) => (k.u - 0.5) ** 2 + (k.v - 0.5) ** 2 < 0.03, far = (k) => (k.u - 0.5) ** 2 + (k.v - 0.5) ** 2 > 0.06;
  f.setCamera({ img: camImg(() => 0, (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.04 ? 1 : 0)), mode: 1, gain: 1, motion: 1 });
  for (let s = 0; s < 2000; s++) f.step();
  const [m, o] = camRegions(f, disc, far);
  ok('T11 motion drives: a moving patch in a black picture nucleates crystal there and nowhere else',
    m > 0.4 && o < 0.02, `crystal in the moving patch ${m.toFixed(2)}, elsewhere ${o.toFixed(2)}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
if (failed.length) process.exit(1);
