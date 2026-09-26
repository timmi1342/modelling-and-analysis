// Отображение бит в символы созвездия, код Грея (раздел 2.1 ТЗ)

export const MODULATIONS = {
  BPSK:    { bps: 1, name: 'BPSK',   kind: 'psk' },
  QPSK:    { bps: 2, name: 'QPSK',   kind: 'psk' },
  '8PSK':  { bps: 3, name: '8-PSK',  kind: 'psk' },
  '16QAM': { bps: 4, name: '16-QAM', kind: 'qam' },
  '64QAM': { bps: 6, name: '64-QAM', kind: 'qam' },
};

export function grayDecode(g) {
  let b = g;
  while (g > 0) {
    g >>= 1;
    b ^= g;
  }
  return b;
}

export function constellation(mod) {
  const spec = MODULATIONS[mod];
  if (!spec) throw new Error(`Неизвестная схема модуляции: ${mod}`);

  const M = 1 << spec.bps;
  const I = new Float64Array(M);
  const Q = new Float64Array(M);

  if (spec.kind === 'psk') {
    for (let s = 0; s < M; s++) {
      const phase = (2 * Math.PI * grayDecode(s)) / M;
      I[s] = Math.cos(phase);
      Q[s] = Math.sin(phase);
    }
  } else {
    const half = spec.bps / 2;
    const levels = 1 << half;
    const mask = levels - 1;
    for (let s = 0; s < M; s++) {
      I[s] = 2 * grayDecode((s >> half) & mask) - (levels - 1);
      Q[s] = 2 * grayDecode(s & mask) - (levels - 1);
    }
  }

  let power = 0;
  for (let s = 0; s < M; s++) power += I[s] * I[s] + Q[s] * Q[s];
  const scale = Math.sqrt(M / power);
  for (let s = 0; s < M; s++) {
    I[s] *= scale;
    Q[s] *= scale;
  }
  return { I, Q };
}

export function mapSymbols(bits, mod) {
  const bps = MODULATIONS[mod].bps;
  const { I: cI, Q: cQ } = constellation(mod);
  const n = Math.floor(bits.length / bps);

  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  const idx = new Uint8Array(n);

  for (let s = 0; s < n; s++) {
    let v = 0;
    for (let b = 0; b < bps; b++) v = (v << 1) | bits[s * bps + b];
    idx[s] = v;
    I[s] = cI[v];
    Q[s] = cQ[v];
  }
  return { I, Q, idx, n };
}

export function hardDecision(rI, rQ, mod) {
  const { I: cI, Q: cQ } = constellation(mod);
  const M = cI.length;
  const n = rI.length;

  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  const idx = new Uint8Array(n);

  for (let s = 0; s < n; s++) {
    let best = 0;
    let bestDist = Infinity;
    for (let m = 0; m < M; m++) {
      const dI = rI[s] - cI[m];
      const dQ = rQ[s] - cQ[m];
      const dist = dI * dI + dQ * dQ;
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    idx[s] = best;
    I[s] = cI[best];
    Q[s] = cQ[best];
  }
  return { I, Q, idx };
}
