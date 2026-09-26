// Параметры, предустановки, проверка ввода (разделы 2.1, 2.6, 6 ТЗ)

export function defaultParams() {
  return {
    carrierHz: 2.4e9,
    powerDbm: -10,
    symbolRate: 1e6,
    modulation: '16QAM',

    source: 'prbs',
    prbsType: 'PRBS9',
    userData: '',
    userFormat: 'bin',
    seed: 1,

    alpha: 0.35,
    span: 12,
    sps: 8,
    nSymbols: 1024,
    ifRatio: 1,

    iq:   { on: false, gainDb: 0.5, phaseDeg: 3 },
    dc:   { on: false, iPct: 2, qPct: 2 },
    pn:   { on: false, levelDbc: -95, offsetHz: 1e5, loopBwHz: 1e4 },
    pa:   { on: false, model: 'saleh', backoffDb: 8, smoothness: 2 },
    awgn: { on: true, snrDb: 35 },

    evmMode: 'reference',

    limits: {
      evmPct: 8,
      evmPeakPct: 20,
      merDb: 22,
      snrDb: 20,
      acprDb: -30,
    },
  };
}

export function derive(p) {
  const fs = p.symbolRate * p.sps;
  const chanBw = p.symbolRate * (1 + p.alpha);
  return {
    ...p,
    fs,
    chanBw,
    chanSpacing: chanBw * 1.25,
  };
}

export const PRESETS = {
  clean: {
    label: 'Идеальный тракт',
    apply: {
      modulation: '16QAM',
      symbolRate: 1e6,
      alpha: 0.35,
      iq: { on: false, gainDb: 0, phaseDeg: 0 },
      dc: { on: false, iPct: 0, qPct: 0 },
      pn: { on: false, levelDbc: -110, offsetHz: 1e5 },
      pa: { on: false, model: 'saleh', backoffDb: 12, smoothness: 2 },
      awgn: { on: false, snrDb: 40 },
      limits: { evmPct: 3, evmPeakPct: 10, merDb: 30, snrDb: 30, acprDb: -45 },
    },
  },
  typical: {
    label: 'Типовой тракт',
    apply: {
      modulation: '16QAM',
      symbolRate: 1e6,
      alpha: 0.35,
      iq: { on: true, gainDb: 0.3, phaseDeg: 2 },
      dc: { on: true, iPct: 1, qPct: 1 },
      pn: { on: true, levelDbc: -98, offsetHz: 1e5 },
      pa: { on: true, model: 'rapp', backoffDb: 8, smoothness: 3 },
      awgn: { on: true, snrDb: 32 },
      limits: { evmPct: 8, evmPeakPct: 20, merDb: 22, snrDb: 20, acprDb: -25 },
    },
  },
  lteQpsk: {
    label: 'LTE, QPSK (упрощённо)',
    apply: {
      modulation: 'QPSK',
      symbolRate: 1.4e6,
      alpha: 0.22,
      awgn: { on: true, snrDb: 25 },
      limits: { evmPct: 17.5, evmPeakPct: 35, merDb: 15, snrDb: 14, acprDb: -20 },
    },
  },
  lte16: {
    label: 'LTE, 16-QAM (упрощённо)',
    apply: {
      modulation: '16QAM',
      symbolRate: 1.4e6,
      alpha: 0.22,
      awgn: { on: true, snrDb: 30 },
      limits: { evmPct: 12.5, evmPeakPct: 28, merDb: 18, snrDb: 18, acprDb: -25 },
    },
  },
  lte64: {
    label: 'LTE, 64-QAM (упрощённо)',
    apply: {
      modulation: '64QAM',
      symbolRate: 1.4e6,
      alpha: 0.22,
      awgn: { on: true, snrDb: 34 },
      limits: { evmPct: 8, evmPeakPct: 20, merDb: 22, snrDb: 22, acprDb: -28 },
    },
  },
  wifi64: {
    label: 'Wi-Fi 802.11, 64-QAM (упрощённо)',
    apply: {
      modulation: '64QAM',
      symbolRate: 3e6,
      alpha: 0.25,
      awgn: { on: true, snrDb: 35 },
      limits: { evmPct: 5.6, evmPeakPct: 15, merDb: 25, snrDb: 25, acprDb: -35 },
    },
  },
};

export function applyPreset(p, key) {
  const preset = PRESETS[key];
  if (!preset) return p;

  const next = structuredClone(p);
  for (const [field, value] of Object.entries(preset.apply)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      next[field] = { ...next[field], ...value };
    } else {
      next[field] = value;
    }
  }
  return next;
}

const RULES = [
  ['symbolRate', 1e3, 1e9, 'Символьная скорость'],
  ['carrierHz', 1e5, 1e11, 'Несущая частота'],
  ['powerDbm', -80, 30, 'Выходная мощность'],
  ['alpha', 0, 1, 'Коэффициент сглаживания'],
  ['span', 2, 32, 'Длительность характеристики фильтра'],
  ['sps', 2, 32, 'Число отсчётов на символ'],
  ['nSymbols', 64, 16384, 'Число символов'],
  ['seed', 0, 2147483647, 'Зерно генератора'],
];

const NESTED_RULES = [
  ['iq', 'gainDb', -6, 6, 'Амплитудное рассогласование I/Q'],
  ['iq', 'phaseDeg', -45, 45, 'Фазовое рассогласование I/Q'],
  ['dc', 'iPct', -50, 50, 'Смещение нуля по оси I'],
  ['dc', 'qPct', -50, 50, 'Смещение нуля по оси Q'],
  ['pn', 'levelDbc', -160, -40, 'Уровень фазового шума'],
  ['pn', 'offsetHz', 10, 1e8, 'Отстройка для фазового шума'],
  ['pn', 'loopBwHz', 100, 1e7, 'Полоса системы фазовой автоподстройки'],
  ['pa', 'backoffDb', 0, 30, 'Отступ от точки насыщения'],
  ['pa', 'smoothness', 0.5, 10, 'Гладкость характеристики усилителя'],
  ['awgn', 'snrDb', -10, 60, 'Отношение сигнал/шум'],
];

export function validate(p) {
  const errors = {};

  for (const [key, min, max, label] of RULES) {
    const v = p[key];
    if (!Number.isFinite(v)) {
      errors[key] = `${label}: требуется число`;
    } else if (v < min || v > max) {
      errors[key] = `${label}: допустим диапазон от ${min} до ${max}`;
    }
  }

  for (const [group, key, min, max, label] of NESTED_RULES) {
    const v = p[group]?.[key];
    if (!Number.isFinite(v)) {
      errors[`${group}.${key}`] = `${label}: требуется число`;
    } else if (v < min || v > max) {
      errors[`${group}.${key}`] = `${label}: допустим диапазон от ${min} до ${max}`;
    }
  }

  if (p.source === 'user' && !/[0-9a-fA-F]/.test(p.userData || '')) {
    errors.userData = 'Пользовательский набор данных пуст';
  }

  if (p.nSymbols * p.sps > 262144) {
    errors.nSymbols = 'Слишком длинный сигнал: уменьшите число символов или отсчётов на символ';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
