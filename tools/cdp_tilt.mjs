/* Hero tilt sensing-area check — same CDP harness as cdp_cursor.mjs.
   Verifies the title keeps reacting above/below its own glyph box and goes
   flat once the pointer is genuinely away.
   Usage: node tools/cdp_tilt.mjs  (needs Chrome on --remote-debugging-port=9333) */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = 'GET') => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json().catch(() => ({}));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params }));
        return new Promise((r, j) => pending.set(mid, { r, j }));
      },
      close: () => ws.close()
    }));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

const target = await http(`/json/new?${encodeURIComponent('file:///C:/Users/chenj/Desktop/portfolio/index.html')}`, 'PUT');
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Runtime.enable');
await sleep(2000);                      // let fonts settle before measuring

const move = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
const evalx = async (e) => {
  const r = await page.send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const state = async () => JSON.parse(await evalx(`(() => {
  var t = window.HeroTilt.instances[0];
  return JSON.stringify({ tx: +t.tx.toFixed(4), ty: +t.ty.toFixed(4) });
})()`));

const box = JSON.parse(await evalx(`(() => {
  var r = document.querySelector('.hero__title-text').getBoundingClientRect();
  return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height });
})()`));
const cx = box.l + box.w / 2;
const cy = box.t + box.h / 2;
console.log(`title box ${Math.round(box.w)}x${Math.round(box.h)} at y=${Math.round(box.t)}`);

const probes = [
  ['at centre',            cx, cy],
  ['60px above top edge',  cx, box.t - 60],
  ['140px above top edge', cx, box.t - 140],
  ['60px below bottom',    cx, box.t + box.h + 60],
  ['140px below bottom',   cx, box.t + box.h + 140],
  ['over the buttons',     cx, box.t + box.h + 66],
  ['far away (page top)',  cx, 40]
];

let pass = true;
for (const [tag, x, y] of probes) {
  await move(x, y);
  await sleep(250);
  const s = await state();
  const active = Math.abs(s.tx) > 0.001 || Math.abs(s.ty) > 0.001;
  console.log(`${tag.padEnd(22)} rotateX=${(s.tx * 180 / Math.PI).toFixed(2)}deg  rotateY=${(s.ty * 180 / Math.PI).toFixed(2)}deg  ${active ? 'TRACKING' : 'flat'}`);
  const inactiveTag = tag === 'far away (page top)';
  const shouldTrack = tag !== 'at centre' && !inactiveTag;
  if (shouldTrack && !active) pass = false;
  if (inactiveTag && active) pass = false;
}

console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
page.close();
process.exit(pass ? 0 : 1);
