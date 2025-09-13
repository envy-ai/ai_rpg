const nunjucks = require('nunjucks');
// Optional: deterministic RNG (npm i seedrandom)
// const seedrandom = require('seedrandom');

nunjucks.configure({ autoescape: true });

// Simple RNG wrapper; swap Math.random with seedrandom(seed) if needed.
function makeRng(seed) {
  if (!seed) return Math.random;
  // const rng = seedrandom(seed);
  // return () => rng();
  // Fallback deterministic LCG if you don't want a dep:
  let state = 0;
  for (let i = 0; i < seed.length; i++) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000);
}

function rollOnce(rng, sides) {
  return Math.floor(rng() * sides) + 1;
}

function parse(notation) {
  const s = notation.trim().toLowerCase();
  // Core: [count]d[sides][keep/drop][reroll][explode][modifier][adv/dis]
  const re = /^(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d+))?(?:r([<>]?)(\d+))?(!)?\s*([+-]\s*\d+)?\s*(adv|dis)?$/;
  const m = s.match(re);
  if (!m) throw new Error(`Bad dice notation: "${notation}"`);
  let [, countStr, sidesStr, kdType, kdN, rOp, rVal, explode, modStr, advdis] = m;

  let count = countStr ? parseInt(countStr, 10) : 1;
  const sides = parseInt(sidesStr, 10);
  if (sides <= 0) throw new Error('Sides must be > 0');
  if (count <= 0) count = 1;

  // d20adv/dis sugar -> override count/kd for d20 only
  if (advdis) {
    if (sides !== 20) throw new Error(`"adv/dis" only valid with d20`);
    count = 2;
    kdType = advdis === 'adv' ? 'kh' : 'kl';
    kdN = '1';
  }

  const keepdrop = kdType ? { type: kdType, n: parseInt(kdN, 10) } : null;
  const reroll = rVal ? { op: rOp || '=', n: parseInt(rVal, 10) } : null;
  const mod = modStr ? parseInt(modStr.replace(/\s+/g, ''), 10) : 0;
  const exploding = !!explode;

  return { count, sides, keepdrop, reroll, mod, exploding };
}

function shouldReroll(val, rr) {
  if (!rr) return false;
  switch (rr.op) {
    case '=': return val === rr.n;
    case '<': return val < rr.n;
    case '>': return val > rr.n;
    default:  return false;
  }
}

function rollDice(notation, opts = {}) {
  const cfg = parse(notation);
  const rng = opts.rng || makeRng(opts.seed || '');
  const safetyMaxRolls = opts.safetyMaxRolls || 1000;

  let allRolls = []; // array of {value, exploded:boolean, idx:number}
  let totalDraws = 0;

  for (let i = 0; i < cfg.count; i++) {
    // base roll with reroll logic
    let v;
    let drawCount = 0;
    do {
      if (++totalDraws > safetyMaxRolls) throw new Error('Exploding/reroll safety cap hit');
      v = rollOnce(rng, cfg.sides);
      drawCount++;
    } while (shouldReroll(v, cfg.reroll) && drawCount < safetyMaxRolls);
    const entry = { value: v, exploded: false, idx: allRolls.length };
    allRolls.push(entry);

    // exploding: keep rolling while max face hits
    if (cfg.exploding) {
      while (v === cfg.sides) {
        if (++totalDraws > safetyMaxRolls) throw new Error('Exploding/reroll safety cap hit');
        const ex = rollOnce(rng, cfg.sides);
        allRolls.push({ value: ex, exploded: true, idx: allRolls.length });
        v = ex;
      }
    }
  }

  // Compute which to keep/drop
  let used = allRolls.map((r, i) => ({ ...r, used: true, order: i }));

  if (cfg.keepdrop) {
    const n = cfg.keepdrop.n;
    // Only base dice should be considered for keep/drop; exploded dice are always used
    const base = used.filter(r => !r.exploded);
    const exploded = used.filter(r => r.exploded);

    // Sort a copy for selection
    const byValAsc = [...base].sort((a, b) => a.value - b.value);
    const byValDesc = [...base].sort((a, b) => b.value - a.value);

    let keepSet = new Set();
    if (cfg.keepdrop.type === 'kh') {
      byValDesc.slice(0, n).forEach(r => keepSet.add(r.idx));
      base.forEach(r => { r.used = keepSet.has(r.idx); });
    } else if (cfg.keepdrop.type === 'kl') {
      byValAsc.slice(0, n).forEach(r => keepSet.add(r.idx));
      base.forEach(r => { r.used = keepSet.has(r.idx); });
    } else if (cfg.keepdrop.type === 'dh') {
      byValDesc.slice(0, n).forEach(r => keepSet.add(r.idx));
      base.forEach(r => { r.used = !keepSet.has(r.idx); });
    } else if (cfg.keepdrop.type === 'dl') {
      byValAsc.slice(0, n).forEach(r => keepSet.add(r.idx));
      base.forEach(r => { r.used = !keepSet.has(r.idx); });
    }

    // Merge back exploded (always used)
    used = [...base, ...exploded].sort((a, b) => a.order - b.order);
  }

  const sumUsed = used.filter(r => r.used).reduce((acc, r) => acc + r.value, 0);
  const total = sumUsed + cfg.mod;

  // Build a concise detail string
  const detailParts = used.map(r => {
    const v = r.value;
    if (!r.used) return `~~${v}~~`;
    if (r.exploded) return `${v}!`;
    return `${v}`;
  });
  const detail = `${notation} -> [${detailParts.join(', ')}]${cfg.mod ? (cfg.mod > 0 ? ` + ${cfg.mod}` : ` - ${Math.abs(cfg.mod)}`) : ''} = ${total}`;

  return {
    total,
    rolls: used,
    modifier: cfg.mod,
    sides: cfg.sides,
    detail,
  };
}

// Example usages:
const examples = [
  '3d6',
  '3d6+2',
  '4d6kh3',
  '4d6dl1',
  'd6!',
  'd6r1',
  'd10r>8',
  'd6r<3!',
  'd20adv',
  'd20dis',
];

if (require.main === module) {
  // Only run examples if this file is run directly
  for (const ex of examples) {
    console.log(nunjucks.renderString('{{ ex|roll_detail("demo-seed") }}', { ex }));
  }
}

// Export functions for use by other modules
module.exports = {
  rollDice,
  makeRng,
  parse
};
