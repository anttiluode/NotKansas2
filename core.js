/*  NOT KANSAS 2: everything of Not Kansas, plus honey(p,q,r): a different hyperbolic honeycomb inside the moon at every level.
 *
 *  CrystalMoon V2 core: the laws of the world, written once on the CPU so they
 *  can be tested, and mirrored line for line by the GPU shaders in index.html.
 *
 *  V1 had one crystal field per world. V2 makes the geometry act on itself:
 *
 *  1. TWO SCALES.  A coarse field ψ (wavelength λc ≈ 8–12) grows the bodies,
 *     walls and rings. A fine field φ (λf ≈ 4–5.5) can only live inside the
 *     coarse body, so every body is made of a finer lattice. The fine crystal
 *     feeds back into where the coarse one may grow (k_fb φ²). What you see is
 *     the surface of Ψ = ψ + β φ.
 *
 *        ∂ψ/∂t = Mψ · [ εc(x) ψ − (qc² + ∇²)² ψ + gc ψ² − ψ³ ] + glue
 *        ∂φ/∂t = Mφ · [ εf(x) φ − (qf² + ∇²)² φ + gf φ² − φ³ ] + glue
 *        εc = ε_islands + trail + k_fb φ² + k_L (light − 0.25) · island
 *        εf = ε_f,sea + (ε_f − ε_f,sea) · smoothstep(0.05, 0.40, ψ)
 *        M  = 1 / (1 + T ψ²) for ψ, 1 / (1 + T φ²) for φ     (the clocks: dense crystal runs slow)
 *
 *  2. MOONLIGHT THAT WRITES.  The moon is the light source. light(x) is the
 *     transmittance of a straight line from x to the moon through the visible
 *     crystal, times a distance falloff. Inside the islands, lit crystal grows and
 *     shadowed crystal melts (k_L (light − 0.25) in εc), so crystals compete for
 *     the moon and shadow each other. The open sea is not lit into crystal. The renderer
 *     uses the same light for shading and for the shafts in the air.
 *
 *  3. THE MEMBRANE.  The moon is the boundary between two worlds. Crossing it,
 *     a ray goes from outer point x to moon-space point I(x) (ordinary
 *     inversion through the sphere), where the renderer shows the inner world
 *     at Φ(I(x)). And Φ ∘ I is just the point reflection
 *
 *        Φ(I(x)) = 2c − x,
 *
 *     which on the voxel lattice is exact: voxel k ↦ voxel (64 − k) mod 64.
 *     So near the moon the two worlds are glued by
 *
 *        glue = γ · b(|x − c|) · (field_other(2c − x) − field(x))
 *
 *     and crystal can grow through the moon: what touches the membrane outside
 *     continues inside, where the inversion bends straight things into arcs
 *     that shrink toward the core.
 *
 *  THE CLOCK, THE LENS and THE PORTAL are as in V1: M slows dense crystal,
 *  light bends toward density (n = 1 + κρ), and the moon is the antipodal
 *  sphere inversion Φ(x) = c − R²(x − c)/|x − c|².
 */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.CM = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 64;
  const MOON = { c: [32, 32, 32], R: 9 };
  const MAX_ISLANDS = 8;
  const LIGHT = { steps: 24, sigma: 0.7, falloff: 18, L0: 0.25 };
  // bent moonlight: photons from the moon, bent by the same lens as the view, absorbed weakly by crystal (glass)
  const PHOTON = { K: 16384, h: 0.8, steps: 48, sigma: 0.12, maxR: 46, cap: 3 };

  function mix(x) {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function rnd(level, k) { return mix(Math.imul(level + 1, 0x9e3779b1) ^ mix(k * 7919 + 13)) / 4294967296; }
  /** Uniform in [0,1) from voxel index, step and channel: integer hash, bit-identical in GLSL (uint maths). */
  function noiseU(i, frame, ch) { return mix(Math.imul(i, 0x9e3779b1) ^ mix(Math.imul(frame, 7919) + Math.imul(ch, 104729) + 1)) / 4294967296; }
  function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // ------------------------------------------------------------------ the laws
  function law(level) {
    const u = (k) => rnd(level, k);
    const L = level === 0
      ? { lamC: 9.0, gC: 1.0, lamF: 4.6, gF: 1.0, epsIsland: 0.26, epsF: 0.32, skin0: -0.2, skin1: 0.3, beta: 0.9, kfb: -0.1, kL: 0.3,
        glue: 1.0, isoFrac: 0.42, kappa: 0.8, T: 1.5, hue: 0.58 }
      : {
        lamC: 8.0 + 4.0 * u(1),
        gC: 0.3 + 1.0 * u(2),
        lamF: 4.2 + 1.2 * u(9),
        gF: 0.6 + 0.7 * u(10),
        epsIsland: 0.18 + 0.14 * u(3),
        epsF: 0.24 + 0.14 * u(11),
        skin0: -0.2, skin1: 0.3,
        beta: 0.6 + 0.4 * u(12),
        kfb: -0.2 + 0.26 * u(13),
        kL: 0.1 + 0.35 * u(14),
        glue: 1.0,
        isoFrac: [0.42, 0.3, -0.15, 0.55][Math.floor(u(4) * 4)],
        kappa: 0.4 + 1.2 * u(5),
        T: 0.5 + 4.0 * u(6),
        hue: u(7),
      };
    L.level = level;
    derive(L);
    const nIsl = level === 0 ? 6 : 4 + Math.floor(u(8) * 4);
    L.islands = [];
    for (let i = 0; i < MAX_ISLANDS; i++) {
      if (i >= nIsl) { L.islands.push({ c: [0, 0, 0], r: 0 }); continue; }
      const r = 9 + 7 * u(50 + i);
      const th = Math.acos(2 * u(60 + 2 * i) - 1), ph = 2 * Math.PI * u(61 + 2 * i);
      // island 0 always touches the membrane, so something grows through the moon
      const d = i === 0 ? MOON.R + 0.5 * r : MOON.R + 0.6 * r + (22 - 0.6 * r) * u(80 + i);
      L.islands.push({ c: [MOON.c[0] + d * Math.sin(th) * Math.cos(ph), MOON.c[1] + d * Math.sin(th) * Math.sin(ph), MOON.c[2] + d * Math.cos(th)], r });
    }
    const shape = L.isoFrac > 0.5 ? 'atoms' : L.isoFrac > 0.35 ? 'atoms and necks' : L.isoFrac > 0 ? 'bonded lattice' : 'foam of bonds';
    const body = L.gC < 0.55 ? 'walls' : L.gC < 0.95 ? 'tubes' : 'bodies';
    L.name = `${body} of ${shape}`;
    return L;
  }
  /** Wavelengths → wave numbers and the explicit step (the coarse field sets the bound). */
  function derive(L) {
    // q² chosen so the 7-point Laplacian's Mexican hat peaks at the stated wavelength along the
    // lattice axes: −∇² has symbol 2 − 2cos k there, not k² (matters at λ ≈ 4–5, not at λ ≈ 9)
    L.qc2 = 2 - 2 * Math.cos(2 * Math.PI / L.lamC); L.qf2 = 2 - 2 * Math.cos(2 * Math.PI / L.lamF);
    // open sea: negative enough that crystal does not creep outward (V1 calibration, T3)
    L.epsSea = -0.3 * Math.max(1, L.gC);
    L.epsSeaF = -0.3 * Math.max(1, L.gF);
    // dt · max_λ |(q² + λ)²| < 2 for λ ∈ [−12, 0], for both fields; the smaller q is the binding one
    const qmin2 = Math.min(L.qc2, L.qf2);
    L.dt = 1.5 / Math.pow(12 - qmin2, 2);
    return L;
  }

  function wrap1(d) { d = Math.abs(d) % N; return Math.min(d, N - d); }

  /** Where coarse crystal may live: islands, now allowed to touch the membrane. */
  function islandMask(L, x, y, z) {
    let m = 0;
    for (const isl of L.islands) {
      if (isl.r <= 0) continue;
      const d = Math.hypot(wrap1(x - isl.c[0]), wrap1(y - isl.c[1]), wrap1(z - isl.c[2]));
      m = Math.max(m, 1 - smoothstep(0.6 * isl.r, isl.r, d));
    }
    const dm = Math.hypot(wrap1(x - MOON.c[0]), wrap1(y - MOON.c[1]), wrap1(z - MOON.c[2]));
    return m * smoothstep(MOON.R - 1, MOON.R + 0.5, dm);
  }
  /** Strength of the gluing between the worlds: 1 at and inside the membrane, gone by R + 3.5. */
  function band(r) { return 1 - smoothstep(MOON.R + 1, MOON.R + 3.5, r); }
  /** The voxel on the other side of the membrane: Φ(I(x)) = 2c − x. */
  function mirrorVoxel(x, y, z) { return [(2 * MOON.c[0] - x + 2 * N) % N, (2 * MOON.c[1] - y + 2 * N) % N, (2 * MOON.c[2] - z + 2 * N) % N]; }

  // ------------------------------------------------------------- the camera (V1, unchanged placement)
  const CAM = { W: 96, H: 72, slabZ: 11, slabHX: 28, slabHY: 21, shellSX: 0.75, shellSY: 0.56 };
  function camTex(img, u, v) {
    const W = CAM.W, H = CAM.H;
    const fx = Math.min(1, Math.max(0, u)) * W - 0.5, fy = Math.min(1, Math.max(0, v)) * H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const ax = Math.min(W - 1, Math.max(0, x0)), bx = Math.min(W - 1, Math.max(0, x0 + 1));
    const ay = Math.min(H - 1, Math.max(0, y0)), by = Math.min(H - 1, Math.max(0, y0 + 1));
    const at = (x, y, c) => img[2 * (y * W + x) + c];
    const out = [0, 0];
    for (let c = 0; c < 2; c++) {
      const top = at(ax, ay, c) + (at(bx, ay, c) - at(ax, ay, c)) * tx;
      const bot = at(ax, by, c) + (at(bx, by, c) - at(ax, by, c)) * tx;
      out[c] = top + (bot - top) * ty;
    }
    return out;
  }
  function rectW(sx, sy) { return (1 - smoothstep(0.9, 1.0, Math.abs(sx))) * (1 - smoothstep(0.9, 1.0, Math.abs(sy))); }
  function camPlace(mode, x, y, z) {
    let w = 0, sx = 0, sy = 0;
    if (mode === 1) {
      sx = (x - 32) / CAM.slabHX; sy = (y - 32) / CAM.slabHY;
      w = (1 - smoothstep(3.0, 5.5, wrap1(z - CAM.slabZ))) * rectW(sx, sy);
    } else if (mode === 2) {
      const R = MOON.R, rx = x - MOON.c[0], ry = y - MOON.c[1], rz = z - MOON.c[2];
      const r = Math.hypot(rx, ry, rz) || 1e-9;
      sx = -(rx / r) / CAM.shellSX; sy = -(ry / r) / CAM.shellSY;
      w = smoothstep(R + 0.5, R + 2, r) * (1 - smoothstep(R + 7, R + 9.5, r)) * smoothstep(0.15, 0.35, rz / r) * rectW(sx, sy);
    }
    return { w, u: 0.5 - 0.5 * sx, v: 0.5 - 0.5 * sy };
  }

  // ------------------------------------------------------- CPU reference field
  class Field {
    constructor(L, n = N) {
      this.L = L; this.n = n;
      const V = n * n * n;
      this.psi = new Float32Array(V); this.phi = new Float32Array(V);
      this.trail = new Float32Array(V); this.eps = new Float32Array(V);
      this.light = new Float32Array(V);          // set from outside (computeLight or a test pattern)
      this.mask = new Float32Array(V);           // where the islands are: the light sculpts islands, it does not flood the sea
      this.other = null;                          // the world on the other side of the membrane
      this.glue = L.glue;
      this.noise = 0.002;                         // per-step nucleation noise where ε > 0
      this.frame = 0;
      this.refreshEps();
    }
    idx(x, y, z) { const n = this.n; return ((z % n + n) % n) * n * n + ((y % n + n) % n) * n + ((x % n + n) % n); }
    refreshEps() {
      const n = this.n, s = N / n;
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = this.idx(x, y, z), m = islandMask(this.L, x * s, y * s, z * s);
        this.mask[i] = m;
        this.eps[i] = this.L.epsSea + (this.L.epsIsland - this.L.epsSea) * m;
      }
    }
    seedNoise(amp, seed = 1) {
      for (let i = 0; i < this.psi.length; i++) {
        this.psi[i] = amp * (mix(i * 2654435761 ^ seed) / 4294967296 - 0.5);
        this.phi[i] = amp * (mix(i * 2246822519 ^ (seed + 77)) / 4294967296 - 0.5);
      }
    }
    _laplace(src, dst) {
      const n = this.n, nn = n * n;
      for (let z = 0; z < n; z++) {
        const zo = z * nn, zp = ((z + 1) % n) * nn, zm = ((z + n - 1) % n) * nn;
        for (let y = 0; y < n; y++) {
          const yo = y * n, yp = ((y + 1) % n) * n, ym = ((y + n - 1) % n) * n;
          for (let x = 0; x < n; x++) {
            const xp = (x + 1) % n, xm = (x + n - 1) % n, i = zo + yo + x;
            dst[i] = src[zo + yo + xp] + src[zo + yo + xm] + src[zo + yp + x] + src[zo + ym + x] + src[zp + yo + x] + src[zm + yo + x] - 6 * src[i];
          }
        }
      }
    }
    /** One explicit step of both fields, identical to the GPU update pass. */
    step(dt = this.L.dt) {
      const L = this.L, n = this.n, V = this.psi.length;
      const qc2 = L.qc2, qf2 = L.qf2;
      const lp = new Float32Array(V), lf = new Float32Array(V), l2p = new Float32Array(V), l2f = new Float32Array(V);
      this._laplace(this.psi, lp); this._laplace(lp, l2p);
      this._laplace(this.phi, lf); this._laplace(lf, l2f);
      const cw = this.cam ? this._camPlaces() : null;
      const o = this.other, glue = o ? this.glue : 0, frame = this.frame | 0;
      const np = new Float32Array(V), nf = new Float32Array(V);
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = this.idx(x, y, z);
        const p = this.psi[i], f = this.phi[i];
        let e0 = this.eps[i], eF0 = 0, h = 0, md = 0, camF = -1, g = 0, j = 0;
        if (glue > 0) {
          // the membrane: near the moon each world may grow wherever the other may (ε shared),
          // and the two fields are pulled together across it, voxel x to voxel 2c − x
          const sc = N / n, r = Math.hypot(x * sc - MOON.c[0], y * sc - MOON.c[1], z * sc - MOON.c[2]);
          const b = band(r);
          if (b > 0) {
            j = o.idx(n - x, n - y, n - z);
            e0 += (Math.max(e0, o.eps[j]) - e0) * b * Math.min(glue, 1);
            g = 2.0 * glue * b;
          }
        }
        if (cw) {
          const k = cw[i];
          if (k.w > 0) {
            const [b, d] = camTex(this.cam.img, k.u, k.v);
            const target = L.epsSea + (L.epsIsland + 0.1 - L.epsSea) * b;
            e0 += (target - e0) * k.w * this.cam.gain;
            md = 0.45 * k.w * this.cam.motion * d;
            h = 0.04 * k.w * this.cam.motion * d;
            camF = k.w * this.cam.gain; eF0 = L.epsSeaF + (L.epsF + 0.1 - L.epsSeaF) * b;
          }
        }
        const ec = e0 + this.trail[i] + md + L.kfb * f * f + L.kL * (this.light[i] - LIGHT.L0) * this.mask[i];
        let ef = L.epsSeaF + (L.epsF - L.epsSeaF) * smoothstep(L.skin0, L.skin1, p);
        if (camF > 0) ef += (eF0 - ef) * camF + md;
        const Mc = 1 / (1 + L.T * p * p), Mf = 1 / (1 + L.T * f * f);   // each lattice runs on its own clock
        const fc = (ec - qc2 * qc2) * p - 2 * qc2 * lp[i] - l2p[i] + L.gC * p * p - p * p * p + h;
        const ff = (ef - qf2 * qf2) * f - 2 * qf2 * lf[i] - l2f[i] + L.gF * f * f - f * f * f + h;
        let a = p + dt * Mc * fc, c = f + dt * Mf * ff;
        if (g > 0) { a += dt * g * (o.psi[j] - p); c += dt * g * (o.phi[j] - f); }
        // a whisper of noise where crystal may grow, so it always nucleates (same integer hash on the GPU)
        if (this.noise > 0) {
          // gated smoothly (not ε > 0), so the CPU/GPU comparison never hinges on the sign of a rounding error
          a += this.noise * (noiseU(i, frame, 1) - 0.5) * smoothstep(0, 0.02, ec);
          c += this.noise * (noiseU(i, frame, 2) - 0.5) * smoothstep(0, 0.02, ef);
        }
        np[i] = a; nf[i] = c;
      }
      this.psi = np; this.phi = nf;
      this.frame = frame + 1;
    }
    setCamera(cam) { this.cam = cam; this._cw = null; }
    _camPlaces() {
      if (this._cw && this._cwMode === this.cam.mode) return this._cw;
      const n = this.n, s = N / n, out = new Array(this.psi.length);
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[this.idx(x, y, z)] = camPlace(this.cam.mode, x * s, y * s, z * s);
      this._cw = out; this._cwMode = this.cam.mode;
      return out;
    }
    /** The visible field Ψ = ψ + βφ. */
    visible() { const b = this.L.beta, out = new Float32Array(this.psi.length); for (let i = 0; i < out.length; i++) out[i] = this.psi[i] + b * this.phi[i]; return out; }
  }

  // ----------------------------------------------------------- moonlight
  /** Trilinear sample of a periodic N³ field at voxel coordinates. */
  function trilinear(f, x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), tx = x - x0, ty = y - y0, tz = z - z0;
    const I = (a, b, c) => f[(((c % N) + N) % N) * N * N + (((b % N) + N) % N) * N + (((a % N) + N) % N)];
    const l = (b, c) => I(x0, b, c) + (I(x0 + 1, b, c) - I(x0, b, c)) * tx;
    const s = (c) => l(y0, c) + (l(y0 + 1, c) - l(y0, c)) * ty;
    return s(z0) + (s(z0 + 1) - s(z0)) * tz;
  }
  /** Light at voxel (x,y,z): transmittance of the straight line to the moon through the
   *  visible crystal (occupancy = smoothstep(0.6·iso, 1.2·iso, pol·Ψ)), times a falloff. */
  function lightAt(occ, x, y, z) {
    const c = MOON.c, vx = c[0] - x, vy = c[1] - y, vz = c[2] - z;
    const d = Math.hypot(vx, vy, vz);
    if (d < MOON.R - 0.5) return 0;
    const ux = vx / d, uy = vy / d, uz = vz / d, s = Math.max(d - MOON.R - 0.5, 0) / LIGHT.steps;
    let acc = 0;
    for (let i = 0; i < LIGHT.steps; i++) { const t = s * (i + 0.5); acc += trilinear(occ, x + ux * t, y + uy * t, z + uz * t) * s; }
    return Math.exp(-LIGHT.sigma * acc) / (1 + Math.pow((d - MOON.R) / LIGHT.falloff, 2));
  }
  function occupancy(Psi, iso, pol) {
    const o = new Float32Array(Psi.length);
    for (let i = 0; i < o.length; i++) o[i] = smoothstep(0.6 * iso, 1.2 * iso, pol * Psi[i]);
    return o;
  }
  function computeLight(field, iso, pol = 1) {
    const occ = occupancy(field.visible(), iso, pol);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) field.light[field.idx(x, y, z)] = lightAt(occ, x, y, z);
    return field.light;
  }


  // ------------------------------------------------------- bent moonlight (photons)
  const BLUR9 = [0.1995, 0.1760, 0.1210, 0.0648, 0.0270];
  /** ρ = Ψ² blurred along x, y, z with the renderer's 9-tap kernel, and ∇ρ by central differences (the view pass). */
  function densityAndGradient(Psi) {
    const V = N * N * N, idx = (x, y, z) => (((z % N) + N) % N) * N * N + (((y % N) + N) % N) * N + (((x % N) + N) % N);
    let a = new Float32Array(V), b = new Float32Array(V);
    for (let i = 0; i < V; i++) a[i] = Psi[i] * Psi[i];
    for (const dir of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -4; k <= 4; k++) s += BLUR9[Math.abs(k)] * a[idx(x + k * dir[0], y + k * dir[1], z + k * dir[2])];
        b[idx(x, y, z)] = s;
      }
      [a, b] = [b, a];
    }
    const rho = a, gx = new Float32Array(V), gy = new Float32Array(V), gz = new Float32Array(V);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = idx(x, y, z);
      gx[i] = 0.5 * (rho[idx(x + 1, y, z)] - rho[idx(x - 1, y, z)]);
      gy[i] = 0.5 * (rho[idx(x, y + 1, z)] - rho[idx(x, y - 1, z)]);
      gz[i] = 0.5 * (rho[idx(x, y, z + 1)] - rho[idx(x, y, z - 1)]);
    }
    return { rho, gx, gy, gz };
  }
  /** Photons leave the moon on a Fibonacci sphere (rotated by rot), follow d(n d)/ds = ∇n with n = 1 + κρ
   *  (the same ray equation as the view rays), lose weight exp(−σ·occ·h) in crystal, and deposit w·h in the
   *  voxel they reach. Returns the fluence, normalised to the free 1/r² falloff (1 at r = R + 2), blurred once.
   *  This is the CPU spec of the GPU photon passes; the GPU reads ρ and ∇ρ from half-float textures. */
  function tracePhotons(Psi, iso, pol, kappa, opt = {}) {
    const K = opt.K || 8192, h = opt.h || PHOTON.h, S = opt.steps || PHOTON.steps, sig = opt.sigma != null ? opt.sigma : PHOTON.sigma;
    const rot = opt.rot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const { rho, gx, gy, gz } = densityAndGradient(Psi);
    const c = MOON.c, R = MOON.R, acc = new Float32Array(N * N * N);
    for (let k = 0; k < K; k++) {
      const zz = 1 - 2 * (k + 0.5) / K, ph = 2 * Math.PI * ((k * 0.3819660112501051) % 1), s = Math.sqrt(Math.max(0, 1 - zz * zz));
      const v = [s * Math.cos(ph), s * Math.sin(ph), zz];
      let d = [rot[0] * v[0] + rot[3] * v[1] + rot[6] * v[2], rot[1] * v[0] + rot[4] * v[1] + rot[7] * v[2], rot[2] * v[0] + rot[5] * v[1] + rot[8] * v[2]];
      let x = [c[0] + d[0] * (R + 0.6), c[1] + d[1] * (R + 0.6), c[2] + d[2] * (R + 0.6)], w = 1;
      for (let st = 0; st < S && w > 0; st++) {
        const r0 = trilinear(rho, ...x), g = [kappa * trilinear(gx, ...x), kappa * trilinear(gy, ...x), kappa * trilinear(gz, ...x)];
        const gd = g[0] * d[0] + g[1] * d[1] + g[2] * d[2];
        for (let i = 0; i < 3; i++) d[i] += h * (g[i] - gd * d[i]) / (1 + kappa * r0);
        const dn = Math.hypot(...d); d = d.map((t) => t / dn);
        for (let i = 0; i < 3; i++) x[i] += d[i] * h;
        const r = Math.hypot(x[0] - c[0], x[1] - c[1], x[2] - c[2]);
        if (r < R || r > PHOTON.maxR) { w = 0; break; }
        w *= Math.exp(-sig * smoothstep(0.6 * iso, 1.2 * iso, pol * trilinear(Psi, ...x)) * h);
        if (w < 0.01) { w = 0; break; }
        const vx = ((Math.round(x[0]) % N) + N) % N, vy = ((Math.round(x[1]) % N) + N) % N, vz = ((Math.round(x[2]) % N) + N) % N;
        acc[(vz * N + vy) * N + vx] += w * h;
      }
    }
    const out = new Float32Array(N * N * N), norm = 4 * Math.PI * (R + 2) * (R + 2) / K;
    const I = (x, y, z) => acc[(((z % N) + N) % N) * N * N + (((y % N) + N) % N) * N + (((x % N) + N) % N)];
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const f = 0.5 * I(x, y, z) + (I(x + 1, y, z) + I(x - 1, y, z) + I(x, y + 1, z) + I(x, y - 1, z) + I(x, y, z + 1) + I(x, y, z - 1)) / 12;
      const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
      out[(z * N + y) * N + x] = d < R - 0.5 ? 0 : Math.min(PHOTON.cap, f * norm);
    }
    return out;
  }


  // ------------------------------------------------------- not Kansas: the hyperbolic moon
  /** The order-5 cubic honeycomb {4,3,5} in the unit Poincaré ball: the central cube's +x face is the sphere
   *  centred (c,0,0), radius ρ, with ρ² = 1 + √5 and c² = 2 + √5 = 1 + ρ² (so it meets the boundary at right angles). */
  const HONEY = { c: Math.sqrt(2 + Math.sqrt(5)), rho2: 1 + Math.sqrt(5) };
  /** Fold a ball point into the chamber x ≥ y ≥ z ≥ 0 of the central cube; k = number of face reflections. Same as the shader. */
  function fold(p0) {
    let p = p0.slice(), k = 0;
    const { c, rho2 } = HONEY;
    for (let i = 0; i < 28; i++) {
      p = p.map(Math.abs).sort((a, b) => b - a);
      const v = [p[0] - c, p[1], p[2]], d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (d2 >= rho2) break;
      p = [c + rho2 * v[0] / d2, rho2 * v[1] / d2, rho2 * v[2] / d2]; k++;
    }
    return { p, k };
  }
  /** Hyperbolic distance between two points of the unit ball. */
  function hypDist(a, b) {
    const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const a2 = a[0] ** 2 + a[1] ** 2 + a[2] ** 2, b2 = b[0] ** 2 + b[1] ** 2 + b[2] ** 2;
    return Math.acosh(1 + 2 * d2 / ((1 - a2) * (1 - b2)));
  }
  /** March a ray in the ball the way the shader does: per hyperbolic step h, d ← d + h (x − (x·d) d), x ← x + d h (1 − r²)/2. */
  function geodesic(x0, d0, h, n) {
    let x = x0.slice(), d = d0.slice(); const pts = [x.slice()];
    for (let i = 0; i < n; i++) {
      const r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2], xd = x[0] * d[0] + x[1] * d[1] + x[2] * d[2];
      d = d.map((t, j) => t + h * (x[j] - xd * t)); const dn = Math.hypot(...d); d = d.map((t) => t / dn);
      x = x.map((t, j) => t + d[j] * h * (1 - r2) / 2);
      pts.push(x.slice());
    }
    return pts;
  }

  // ------------------------------------------------------- Not Kansas 2: a honeycomb for every level
  /** The regular honeycomb {p,q,r} of hyperbolic space in the unit Poincaré ball: cells {p,q}, r of them round every edge.
   *  Its symmetry group is the Coxeter group [p,q,r], generated by four mirrors with
   *      angle(m0,m1) = π/p,   angle(m1,m2) = π/q,   angle(m2,m3) = π/r,   every other pair at right angles.
   *  m0, m1, m2 are planes through the centre of the central cell (unit normals n0, n1, n2: the cell's own symmetry
   *  [p,q]); m3 is the cell's face, a sphere meeting the wall at right angles, centre (0,0,c), radius ρ:
   *      n0 = (1,0,0),  n1 = (−cos π/p, sin π/p, 0),  n2 = (0, a, b),  a = −cos(π/q)/sin(π/p),  b = √(1 − a²)
   *      ρ² = b² / (cos²(π/r) − b²),      c² = 1 + ρ²
   *  The chamber (one flag of the honeycomb) is  x·n0 ≥ 0, x·n1 ≥ 0, x·n2 ≥ 0, |x − C| ≥ ρ.  Its four corners are the
   *  cell's centre (the origin), a face centre, an edge midpoint and a vertex.
   *  Vertices are inside the ball (compact), on the wall (ideal) or beyond it (hyperideal: the edges run into the wall). */
  function honey(p, q, r) {
    const cp = Math.cos(Math.PI / p), sp = Math.sin(Math.PI / p);
    const a = -Math.cos(Math.PI / q) / sp, b = Math.sqrt(1 - a * a);
    const n0 = [1, 0, 0], n1 = [-cp, sp, 0], n2 = [0, a, b];
    const cosT = Math.cos(Math.PI / r), sinT = Math.sin(Math.PI / r);
    const rho2 = b * b / (cosT * cosT - b * b), rho = Math.sqrt(rho2), c = Math.sqrt(1 + rho2);
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const unit = (u) => { const l = Math.hypot(...u); return u.map((t) => t / l); };
    // a ray from the centre in direction u (|u| = 1) meets the face sphere at t = c u_z − √(c² u_z² − 1)
    const reach = (u) => { const D = c * c * u[2] * u[2] - 1; return D > 1e-12 ? c * u[2] - Math.sqrt(D) : (D > -1e-12 ? 1 : NaN); };
    let v = unit(cross(n1, n2)); if (v[0] < 0) v = v.map((t) => -t);          // toward the vertex: on m1 and m2
    let e = unit(cross(n0, n2)); if (e[0] * n1[0] + e[1] * n1[1] + e[2] * n1[2] < 0) e = e.map((t) => -t);   // toward the edge midpoint: on m0 and m2
    const tv = reach(v), te = reach(e);
    const kind = Number.isNaN(tv) ? 'hyperideal' : (tv > 1 - 1e-9 ? 'ideal' : 'compact');
    const H = { p, q, r, n0, n1, n2, C: [0, 0, c], c, rho, rho2, cosT, sinT, kind,
      vertex: kind === 'compact' ? v.map((t) => t * tv) : null, vdir: v,
      mid: e.map((t) => t * te),
      inradius: 2 * Math.atanh(c - rho), midradius: 2 * Math.atanh(te),
      circumradius: kind === 'compact' ? 2 * Math.atanh(tv) : Infinity,
      dihedral: 360 / r };
    H.halfEdge = kind === 'compact' ? hypDist(H.vertex, H.mid) : Infinity;
    H.orb = Math.tanh(0.5 * 0.24 * H.inradius);            // the door at the centre of every cell: a ball of hyperbolic radius 0.24 × inradius
    return H;
  }
  /** One honeycomb per level, eight of them, then round again. The first four are ALL the regular honeycombs of
   *  hyperbolic 3-space with finite cells and finite vertex figures (Coxeter). The next four have their corners at infinity. */
  const HONEYS = [
    [4, 3, 5, 'cubes', 'five'], [5, 3, 4, 'dodecahedra', 'four'], [3, 5, 3, 'icosahedra', 'three'], [5, 3, 5, 'dodecahedra', 'five'],
    [4, 3, 6, 'cubes', 'six'], [3, 4, 4, 'octahedra', 'four'], [3, 3, 6, 'tetrahedra', 'six'], [5, 3, 6, 'dodecahedra', 'six'],
  ].map(([p, q, r, cell, word]) => Object.assign(honey(p, q, r), { cell, symbol: `{${p},${q},${r}}`,
    name: `{${p},${q},${r}} · ${cell}, ${word} round every edge` }));
  HONEYS.forEach((H) => { if (H.kind === 'ideal') H.name += ', corners at infinity'; });
  function honeyOf(level) { return HONEYS[((level % HONEYS.length) + HONEYS.length) % HONEYS.length]; }
  /** Reflect x in mirror i of honeycomb H (0, 1, 2: planes; 3: inversion in the face sphere). */
  function mirror(H, i, x) {
    if (i < 3) { const n = H['n' + i], d = 2 * (x[0] * n[0] + x[1] * n[1] + x[2] * n[2]); return [x[0] - d * n[0], x[1] - d * n[1], x[2] - d * n[2]]; }
    const v = [x[0], x[1], x[2] - H.c], s = H.rho2 / (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [s * v[0], s * v[1], H.c + s * v[2]];
  }
  /** Fold a ball point into the chamber of H. k = faces crossed, passes = loop passes used. Same loop as the shader. */
  function foldH(H, p0, maxPass = 40) {
    let p = p0.slice(), k = 0, passes = 0, done = false;
    const { n1, n2, c, rho2 } = H;
    for (let i = 0; i < maxPass; i++) {
      passes++;
      let ch = false;
      p[0] = Math.abs(p[0]);
      const a = p[0] * n1[0] + p[1] * n1[1];
      if (a < 0) { p[0] -= 2 * a * n1[0]; p[1] -= 2 * a * n1[1]; ch = true; }
      const b = p[1] * n2[1] + p[2] * n2[2];
      if (b < 0) { p[1] -= 2 * b * n2[1]; p[2] -= 2 * b * n2[2]; ch = true; }
      const vz = p[2] - c, d2 = p[0] * p[0] + p[1] * p[1] + vz * vz;
      if (d2 < rho2) { const s = rho2 / d2; p = [s * p[0], s * p[1], c + s * vz]; k++; ch = true; }
      if (!ch) { done = true; break; }
    }
    return { p, k, passes, done };
  }
  /** sinh of the hyperbolic distance from a chamber point to the cell's edge (the geodesic m2 ∩ m3). With s2, s3 the sinh
   *  of the distances to the two mirrors, which meet at π/r:  sinh d = √(s2² + s3² + 2 s2 s3 cos π/r) / sin π/r. */
  function edgeSinh(H, p) {
    const w = 1 - (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    const s2 = 2 * (p[1] * H.n2[1] + p[2] * H.n2[2]) / w;
    const s3 = (p[0] * p[0] + p[1] * p[1] + (p[2] - H.c) ** 2 - H.rho2) / (H.rho * w);
    return Math.sqrt(Math.max(0, s2 * s2 + s3 * s3 + 2 * s2 * s3 * H.cosT)) / H.sinT;
  }

  // ------------------------------------------------------------ the moon portal
  function portal(x, c = MOON.c, R = MOON.R) {
    const r = [x[0] - c[0], x[1] - c[1], x[2] - c[2]];
    const s = R * R / (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
    return [c[0] - s * r[0], c[1] - s * r[1], c[2] - s * r[2]];
  }
  /** Ordinary inversion through the moon's surface (outside ↔ inside along the same ray). */
  function invert(x, c = MOON.c, R = MOON.R) {
    const r = [x[0] - c[0], x[1] - c[1], x[2] - c[2]];
    const s = R * R / (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
    return [c[0] + s * r[0], c[1] + s * r[1], c[2] + s * r[2]];
  }
  function portalJacobian(x, c = MOON.c, R = MOON.R) {
    const r = [x[0] - c[0], x[1] - c[1], x[2] - c[2]];
    const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
    const n = Math.sqrt(r2), h = r.map((v) => v / n), s = R * R / r2;
    const J = [];
    for (let i = 0; i < 3; i++) { J.push([]); for (let j = 0; j < 3; j++) J[i].push(s * (2 * h[i] * h[j] - (i === j ? 1 : 0))); }
    return J;
  }

  return { N, MOON, MAX_ISLANDS, CAM, LIGHT, PHOTON, HONEY, fold, hypDist, geodesic, honey, HONEYS, honeyOf, mirror, foldH, edgeSinh, tracePhotons, densityAndGradient, law, derive, islandMask, band, mirrorVoxel, Field, computeLight, lightAt, occupancy,
    trilinear, noiseU, portal, invert, portalJacobian, camTex, camPlace, mix, rnd, smoothstep, wrap1 };
});
