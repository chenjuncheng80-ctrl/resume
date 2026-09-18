/* Drive a real Chrome over CDP so requestAnimationFrame actually ticks —
   headless --dump-dom with --virtual-time-budget only yields a frame or two.
   Verifies that the four brackets stay welded to a target's corners while the
   pointer roams inside it.
   Usage: node tools/cdp_cursor.mjs */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      close: () => ws.close()
    }));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

const PAGE = 'file:///C:/Users/chenj/Desktop/portfolio/tools/cursor_probe.html';
const BORDER = 3, SIZE = 12;

function expectCorners(btn) {
  const [l, t, r, bo] = btn;
  return [
    [l - BORDER, t - BORDER, l - BORDER + SIZE, t - BORDER + SIZE],
    [r - SIZE + BORDER, t - BORDER, r + BORDER, t - BORDER + SIZE],
    [r - SIZE + BORDER, bo - SIZE + BORDER, r + BORDER, bo + BORDER],
    [l - BORDER, bo - SIZE + BORDER, l - BORDER + SIZE, bo + BORDER]
  ];
}

const worst = (a, b) => Math.max(...a.flat().map((v, i) => Math.abs(v - b.flat()[i])));

const target = await http(`/json/new?${encodeURIComponent(PAGE)}`, 'PUT');
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Runtime.enable');
await sleep(600);

const move = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
const measure = async () => {
  const r = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__measure())', returnByValue: true });
  return JSON.parse(r.result.value);
};

await move(60, 60);           // far from anything
await sleep(400);

await move(420, 288);         // enter the button
await sleep(500);
const centre = await measure();

await move(330, 272);         // inside, upper left
await sleep(300);
const insideA = await measure();

await move(520, 306);         // inside, lower right
await sleep(300);
const insideB = await measure();

const exp = expectCorners(centre.btn);
const rows = [
  ['locked at centre', centre],
  ['inside upper-left', insideA],
  ['inside lower-right', insideB]
];
let pass = true;
for (const [tag, m] of rows) {
  const err = worst(m.corners, exp);
  if (err > 0.6) pass = false;
  console.log(`${tag.padEnd(20)} corner error = ${err.toFixed(2)}px`);
}
const drift = Math.max(worst(insideA.corners, centre.corners), worst(insideB.corners, centre.corners));
if (drift > 0.6) pass = false;
console.log(`drift while moving inside = ${drift.toFixed(2)}px`);
console.log(`dot still follows = ${(Math.abs(insideB.wrap[0] - 520) < 40 && Math.abs(insideB.wrap[1] - 306) < 40)}`);
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');

await http(`/json/close/${target.id}`, "PUT").catch(() => {});
page.close();
process.exit(pass ? 0 : 1);
