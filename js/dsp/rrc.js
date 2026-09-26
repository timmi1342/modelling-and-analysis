// Формирующий фильтр RRC и квадратурная модуляция (раздел 2.1 ТЗ)

export function rrcTaps(alpha, span, sps) {
  const a = Math.min(Math.max(alpha, 0), 1);
  const N = span * sps;
  const taps = new Float64Array(N + 1);
  const eps = 1e-8;

  for (let i = 0; i <= N; i++) {
    const t = (i - N / 2) / sps;
    let h;

    if (Math.abs(t) < eps) {
      h = 1 + a * (4 / Math.PI - 1);
    } else if (a > eps && Math.abs(Math.abs(t) - 1 / (4 * a)) < eps) {
      const x = Math.PI / (4 * a);
      h = (a / Math.SQRT2) *
          ((1 + 2 / Math.PI) * Math.sin(x) + (1 - 2 / Math.PI) * Math.cos(x));
    } else {
      const pt = Math.PI * t;
      const num = Math.sin(pt * (1 - a)) + 4 * a * t * Math.cos(pt * (1 + a));
      const den = pt * (1 - Math.pow(4 * a * t, 2));
      h = num / den;
    }
    taps[i] = h;
  }

  let energy = 0;
  for (let i = 0; i <= N; i++) energy += taps[i] * taps[i];
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i <= N; i++) taps[i] *= scale;

  return taps;
}

export function upsample(x, sps) {
  const out = new Float64Array(x.length * sps);
  for (let i = 0; i < x.length; i++) out[i * sps] = x[i];
  return out;
}

export function convolve(x, h) {
  const n = x.length;
  const m = h.length;
  const out = new Float64Array(n + m - 1);

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    for (let k = 0; k < m; k++) out[i + k] += xi * h[k];
  }
  return out;
}

export function shape(I, Q, taps, sps) {
  const delay = (taps.length - 1) / 2;
  const n = I.length * sps;

  const fullI = convolve(upsample(I, sps), taps);
  const fullQ = convolve(upsample(Q, sps), taps);

  const outI = new Float64Array(n);
  const outQ = new Float64Array(n);
  const g = Math.sqrt(sps);

  for (let i = 0; i < n; i++) {
    outI[i] = fullI[i + delay] * g;
    outQ[i] = fullQ[i + delay] * g;
  }
  return { I: outI, Q: outQ };
}
