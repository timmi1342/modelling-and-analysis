// Источник данных: PRBS, случайные биты, пользовательский набор (раздел 2.1 ТЗ)

export const PRBS_TYPES = {
  PRBS7:  { len: 7,  taps: [6, 0],  poly: 'x^7 + x^6 + 1' },
  PRBS9:  { len: 9,  taps: [5, 0],  poly: 'x^9 + x^5 + 1' },
  PRBS11: { len: 11, taps: [9, 0],  poly: 'x^11 + x^9 + 1' },
  PRBS15: { len: 15, taps: [14, 0], poly: 'x^15 + x^14 + 1' },
  PRBS23: { len: 23, taps: [18, 0], poly: 'x^23 + x^18 + 1' },
  PRBS31: { len: 31, taps: [28, 0], poly: 'x^31 + x^28 + 1' },
};

export function prbs(type, nBits, seed = 1) {
  const spec = PRBS_TYPES[type];
  if (!spec) throw new Error(`Неизвестный тип последовательности: ${type}`);

  const { len, taps } = spec;
  const mask = len >= 31 ? 0x7fffffff : (1 << len) - 1;
  let reg = (Math.imul((seed >>> 0) || 1, 0x9e3779b1) >>> (32 - len)) & mask;
  if (reg === 0) reg = mask;

  const out = new Uint8Array(nBits);
  const [t1, t2] = taps;

  for (let i = 0; i < nBits; i++) {
    const feedback = ((reg >>> t1) ^ (reg >>> t2)) & 1;
    out[i] = reg & 1;
    reg = ((reg >>> 1) | (feedback << (len - 1))) & mask;
  }
  return out;
}

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const mag = Math.sqrt(-2 * Math.log(u1));
  return [mag * Math.cos(2 * Math.PI * u2), mag * Math.sin(2 * Math.PI * u2)];
}

export function randomBits(nBits, seed = 12345) {
  const rand = rng(seed);
  const out = new Uint8Array(nBits);
  for (let i = 0; i < nBits; i++) out[i] = rand() < 0.5 ? 0 : 1;
  return out;
}

export function userBits(text, format = 'bin') {
  const bits = [];

  if (format === 'bin') {
    for (const ch of text) {
      if (ch === '0' || ch === '1') bits.push(ch === '1' ? 1 : 0);
    }
  } else if (format === 'hex') {
    for (const ch of text) {
      const v = parseInt(ch, 16);
      if (Number.isNaN(v)) continue;
      for (let b = 3; b >= 0; b--) bits.push((v >> b) & 1);
    }
  } else {
    for (const byte of new TextEncoder().encode(text)) {
      for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
    }
  }

  if (bits.length === 0) {
    throw new Error('Пользовательский набор данных не содержит ни одного бита');
  }
  return Uint8Array.from(bits);
}

export function tile(bits, nBits) {
  if (bits.length === nBits) return bits;
  const out = new Uint8Array(nBits);
  for (let i = 0; i < nBits; i++) out[i] = bits[i % bits.length];
  return out;
}

export function makeBits(p, nBits) {
  switch (p.source) {
    case 'prbs':
      return prbs(p.prbsType, nBits, p.seed);
    case 'random':
      return randomBits(nBits, p.seed);
    case 'user':
      return tile(userBits(p.userData, p.userFormat), nBits);
    default:
      throw new Error(`Неизвестный источник данных: ${p.source}`);
  }
}
