// Полный тракт обработки данных (раздел 3 ТЗ)

import { makeBits } from './source.js';
import { mapSymbols, MODULATIONS } from './mapper.js';
import { rrcTaps, shape } from './rrc.js';
import { applyImpairments } from './impairments.js';

export function buildSignal(p) {
  const bps = MODULATIONS[p.modulation].bps;
  const nBits = p.nSymbols * bps;

  const bits = makeBits(p, nBits);
  const sym = mapSymbols(bits, p.modulation);
  const taps = rrcTaps(p.alpha, p.span, p.sps);
  const ideal = shape(sym.I, sym.Q, taps, p.sps);

  const I = Float64Array.from(ideal.I);
  const Q = Float64Array.from(ideal.Q);
  applyImpairments(I, Q, p, p.fs);

  return {
    bits,
    symI: sym.I,
    symQ: sym.Q,
    symIdx: sym.idx,
    nSymbols: sym.n,
    idealI: ideal.I,
    idealQ: ideal.Q,
    I,
    Q,
    taps,
    fs: p.fs,
  };
}

export function toIfWaveform(sig, p, maxSamples = 2048) {
  const n = Math.min(sig.I.length, maxSamples);
  const out = new Float64Array(n);
  const w = (2 * Math.PI * p.ifRatio) / p.sps;

  for (let i = 0; i < n; i++) {
    out[i] = sig.I[i] * Math.cos(w * i) - sig.Q[i] * Math.sin(w * i);
  }
  return out;
}

export function eyeTraces(sig, p, maxTraces = 200) {
  const span = 2 * p.sps;
  const start = p.span * p.sps;
  const available = Math.floor((sig.I.length - start) / span);
  const count = Math.min(maxTraces, Math.max(available, 0));

  const tracesI = [];
  const tracesQ = [];

  for (let t = 0; t < count; t++) {
    const off = start + t * span;
    tracesI.push(sig.I.subarray(off, off + span));
    tracesQ.push(sig.Q.subarray(off, off + span));
  }
  return { tracesI, tracesQ, span };
}

export function signalPower(sig) {
  let p = 0;
  for (let i = 0; i < sig.I.length; i++) {
    p += sig.I[i] * sig.I[i] + sig.Q[i] * sig.Q[i];
  }
  return p / sig.I.length;
}

export function papr(sig) {
  let mean = 0;
  let peak = 0;
  for (let i = 0; i < sig.I.length; i++) {
    const inst = sig.I[i] * sig.I[i] + sig.Q[i] * sig.Q[i];
    mean += inst;
    if (inst > peak) peak = inst;
  }
  mean /= sig.I.length;
  return 10 * Math.log10(peak / Math.max(mean, 1e-30));
}
