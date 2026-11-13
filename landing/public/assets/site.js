// The X account. Until it's set, every X link stays hidden.
const X_URL = 'https://x.com/subbbbmarine';
if (X_URL) {
  document.querySelectorAll('[data-x]').forEach((a) => { a.href = X_URL; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.hidden = false; });
  document.querySelectorAll('[data-x-off]').forEach((e) => e.remove());
}
// One numbered row open at a time.
const rows = document.querySelectorAll('.rows > button');
rows.forEach((row) => row.addEventListener('click', () => rows.forEach((r) => r.classList.toggle('on', r === row))));

/*
 * A line figure: the seabed beside the five things. Thin lines in
 * the colour of the page's own rules, and one turquoise point each. Drawn only while on screen; still for reduced motion.
 */
const ACC = [102, 228, 236];
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ink = (a) => `rgba(244, 243, 240, ${a})`;
const acc = (a) => `rgba(${ACC[0]}, ${ACC[1]}, ${ACC[2]}, ${a})`;

function figure(canvas, draw) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener('resize', () => {
    size();
    if (still) frame(0);
  });
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, t / 1000);
  };
  if (still) return frame(4000);
  let on = false;
  let raf = 0;
  const loop = (t) => {
    frame(t);
    if (on) raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => {
    on = e.isIntersecting;
    cancelAnimationFrame(raf);
    if (on) raf = requestAnimationFrame(loop);
  }).observe(canvas);
}

// The hero: a feed of trades and orders as the terminal lists them, newest on top, one every second or two, for ever. An example
// only: the coins are well-known memes from other chains, the wallets and figures are made up, in the scale of Submarine's curve
// (a coin opens at 1,875 ZRO of market cap and moves to its pool at 30,000 ZRO).
(() => {
  const list = document.getElementById('feed');
  if (!list) return;
  const COINS = ['pepe', 'bonk', 'wif', 'popcat', 'bome', 'fartcoin', 'moodeng', 'andy', 'billy', 'chillguy', 'floki',
    'hosico', 'myro', 'pengu', 'ponke', 'retardio', 'slerf', 'turbo', 'wojak'];
  const NAMES = { chillguy: 'CHILLGUY' };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const between = (a, b) => a + Math.random() * (b - a);
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const wallet = () => `0x${Array.from({ length: 4 }, hex).join('')}…${Array.from({ length: 4 }, hex).join('')}`;
  // ZRO, written the way a ticker is: whole under a thousand, then thousands with one decimal
  const z = (v) => `${v >= 1000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K` : Math.round(v).toLocaleString('en-US')} $ZRO`;
  // a market cap in ZRO: most coins still on the curve (3K to 30K), some on their pool
  const capNow = () => (Math.random() < 0.8 ? between(3000, 30000) : between(30000, 240000));
  const size = () => pick([5, 12, 25, 40, 50, 80, 120, 200, 350, 500, 900]);

  // A trade, or an order, with the coin's market cap or the order's state under the amount.
  const KINDS = [
    [5, () => ({ act: `Bought · ${wallet()}`, amt: `+${z(size())}`, cls: 'buy', sub: `${z(capNow())} cap` })],
    [4, () => ({ act: `Sold · ${wallet()}`, amt: `−${z(size())}`, cls: 'sell', sub: `${z(capNow())} cap` })],
    // a limit order while it waits is just that, a limit order; once it fills it becomes a limit buy or a limit sell
    [3, () => {
      const now = capNow();
      const at = now * between(0.6, 0.85);
      return { badge: ['limit', 'Limit order'], act: `Buys at ${z(at)}`, amt: z(size()), cls: 'order', sub: 'Waiting' };
    }],
    [2, () => {
      const now = capNow();
      const at = now * between(1.3, 1.9);
      return { badge: ['limit', 'Limit order'], act: `Sells at ${z(at)}`, amt: z(size()), cls: 'order', sub: 'Waiting' };
    }],
    [3, () => {
      const now = capNow();
      const at = now * between(0.62, 0.82);
      return { badge: ['stop', 'Stop loss'], act: `Sells at ${z(at)}`, amt: z(size()), cls: 'stop', sub: 'Waiting' };
    }],
    [2, () => {
      const now = capNow();
      const at = now * between(1.4, 2.2);
      return { badge: ['tp', 'Take profit'], act: `Sells at ${z(at)}`, amt: z(size()), cls: 'tp', sub: 'Waiting' };
    }],
    [2, () => {
      const at = capNow();
      return { badge: ['fill', 'Limit buy'], act: `Bought at ${z(at)}`, amt: `+${z(size())}`, cls: 'buy', sub: 'Filled' };
    }],
    [1, () => {
      const at = capNow();
      return { badge: ['fill', 'Limit sell'], act: `Sold at ${z(at)}`, amt: `−${z(size())}`, cls: 'sell', sub: 'Filled' };
    }],
    // a stop or a take profit that has gone off: the badge keeps its kind, the row says it sold and is filled
    [1, () => {
      const at = capNow();
      return { badge: ['stop', 'Stop loss'], act: `Sold at ${z(at)}`, amt: `−${z(size())}`, cls: 'sell', sub: 'Filled' };
    }],
    [1, () => {
      const at = capNow();
      return { badge: ['tp', 'Take profit'], act: `Sold at ${z(at)}`, amt: `−${z(size())}`, cls: 'tp', sub: 'Filled' };
    }],
    [1, () => ({ badge: ['pool', 'Pool'], act: 'Liquidity locked', amt: '6,000 $ZRO', cls: 'pool', sub: 'raised' })],
  ];
  const total = KINDS.reduce((s, [w]) => s + w, 0);
  const kind = () => {
    let r = Math.random() * total;
    for (const [w, f] of KINDS) if ((r -= w) < 0) return f;
    return KINDS[0][1];
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let last = '';
  const card = () => {
    let id = pick(COINS);
    while (id === last) id = pick(COINS);
    last = id;
    const t = kind()();
    const row = el('div', 'trade');
    const pic = el('span', 'pic');
    pic.style.backgroundImage = `url(assets/coins/${id}.jpg)`;
    const left = el('div', 'who');
    const tk = el('div', 'tk');
    tk.append(el('span', 'nm', `$${NAMES[id] ?? id.toUpperCase()}`));
    if (t.badge) tk.append(el('span', `badge ${t.badge[0]}`, t.badge[1]));
    left.append(tk, el('div', 'act', t.act));
    const right = el('div', 'side');
    right.append(el('div', `amt ${t.cls}`, t.amt), el('div', 'cap', t.sub));
    row.append(pic, left, right);
    return row;
  };
  for (let i = 0; i < 10; i++) list.appendChild(card());
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const add = () => {
    const row = card();
    row.classList.add('new');
    list.prepend(row);
    const h = row.offsetHeight + 10;
    row.animate(
      [
        { marginTop: `-${h}px`, opacity: 0 },
        { marginTop: '0px', opacity: 1 },
      ],
      { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    while (list.children.length > 12) list.lastElementChild.remove();
  };
  const loop = () => {
    if (document.visibilityState === 'visible') add();
    window.setTimeout(loop, 1300 + Math.random() * 1600);
  };
  window.setTimeout(loop, 1400);
})();

// Beside the five things: the seabed below, as a chart draws it. Depth contours of a smooth terrain, seen at a slant from above,
// drifting slowly towards the viewer as if the boat were moving over it. It runs off the column's sides and bottom, and melts
// into the dark at the far edge.
const seabedNoise = (() => {
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (v) => v * v * (3 - 2 * v);
  const value = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y) => value(x, y) * 0.6 + value(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + value(x * 4.3 + 1, y * 4.3 + 9) * 0.12;
})();

figure(document.getElementById('globe'), (ctx, w, h, t) => {
  const NX = 110;
  const NZ = 84;
  const Z0 = -0.09; // start nearer than the canvas bottom, so the terrain runs off the foot of the column
  const Z1 = 1.3;
  const X = 3.2; // the terrain runs from -X to X, wider than the view, so the sides are always cut
  const drift = t * 0.035; // slow travel over the bottom
  const heights = new Float32Array((NX + 1) * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = -X + (2 * X * i) / NX;
      const z = Z0 + ((Z1 - Z0) * j) / NZ;
      heights[j * (NX + 1) + i] = seabedNoise(x * 1.5 + 11, (z * 0.8 + drift) * 3.4);
    }
  }
  // where a point of the terrain lands on screen: near the bottom of the canvas wide and low, far near the top and narrow
  const project = (x, z, y) => {
    const d = 0.32 + z * 1.15;
    const s = 0.32 / d;
    return [w / 2 + x * w * 0.62 * s, h * 0.02 + h * 1.02 * s - y * h * 0.22 * s];
  };
  const levels = 22;
  ctx.lineWidth = 1;
  for (let l = 1; l < levels; l++) {
    const iso = l / levels;
    const major = l % 5 === 0;
    ctx.strokeStyle = ink(major ? 0.34 : 0.16);
    ctx.setLineDash(major ? [] : [2, 3]);
    ctx.beginPath();
    for (let j = 0; j < NZ; j++) {
      const z0 = Z0 + ((Z1 - Z0) * j) / NZ;
      const z1 = Z0 + ((Z1 - Z0) * (j + 1)) / NZ;
      for (let i = 0; i < NX; i++) {
        const a = heights[j * (NX + 1) + i];
        const b = heights[j * (NX + 1) + i + 1];
        const c = heights[(j + 1) * (NX + 1) + i + 1];
        const d = heights[(j + 1) * (NX + 1) + i];
        const code = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (c > iso ? 4 : 0) | (d > iso ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const x0 = -X + (2 * X * i) / NX;
        const x1 = -X + (2 * X * (i + 1)) / NX;
        // the points where the level crosses each edge of the cell
        const e = [
          () => project(x0 + ((iso - a) / (b - a)) * (x1 - x0), z0, iso), // top
          () => project(x1, z0 + ((iso - b) / (c - b)) * (z1 - z0), iso), // right
          () => project(x0 + ((iso - d) / (c - d)) * (x1 - x0), z1, iso), // bottom
          () => project(x0, z0 + ((iso - a) / (d - a)) * (z1 - z0), iso), // left
        ];
        const seg = (p, q) => {
          const P = e[p]();
          const Q = e[q]();
          ctx.moveTo(P[0], P[1]);
          ctx.lineTo(Q[0], Q[1]);
        };
        switch (code) {
          case 1: case 14: seg(3, 0); break;
          case 2: case 13: seg(0, 1); break;
          case 3: case 12: seg(3, 1); break;
          case 4: case 11: seg(1, 2); break;
          case 6: case 9: seg(0, 2); break;
          case 7: case 8: seg(3, 2); break;
          case 5: seg(3, 0); seg(1, 2); break;
          case 10: seg(0, 1); seg(3, 2); break;
        }
      }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // melt into the dark towards the far edge, so the terrain has no hard top
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.3, 'rgba(0,0,0,0.92)');
  fade.addColorStop(0.65, 'rgba(0,0,0,0.45)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h * 0.72);
  ctx.globalCompositeOperation = 'source-over';
});
