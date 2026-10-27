/* Record mode for YouTube Shorts. A widget loads this only when its URL has ?record.
   The widget draws on a 1080×1920 canvas and passes:
     name     video file name (shorts/<name>.mp4)
     seconds  video length; fps (default 30)
     reset()  start the scene from the beginning (same seed every time)
     tick(i)  advance the scene by one video frame (i = frame number)
     render() draw the scene
     captions [{ from, to, text, size? }] in seconds, "\n" breaks lines; captionY in pixels
   This file adds the captions, plays a looping preview, and on "Record" (or the R key) steps through
   every frame and sends it to .claude/record-server.py, which makes the MP4.
   No site address in the video (Zak's choice): the link goes in the YouTube description. */
(() => {
const FADE = 0.35;

window.ShortsRec = function (o) {
  const fps = o.fps || 30, N = Math.round(o.seconds * fps);
  const cv = o.canvas, ctx = cv.getContext('2d');
  const captionY = o.captionY || 300;
  let idx = 0, t0 = 0, recording = false, raf = 0, holdUntil = 0;

  function overlay(t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 22;
    for (const c of o.captions) {
      if (t < c.from || t > c.to) continue;
      const fin = c.from > 0 ? Math.min(1, (t - c.from) / FADE) : 1;   // a caption at 0 s is there from the first frame
      const a = Math.min(fin, (c.to - t) / FADE, 1);
      const rise = (1 - fin) * 18;
      const lines = c.text.split('\n');
      let size = c.size || 76;
      ctx.font = `700 ${size}px "Bricolage Grotesque", sans-serif`;
      const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
      if (widest > 960) { size = Math.floor(size * 960 / widest); ctx.font = `700 ${size}px "Bricolage Grotesque", sans-serif`; }
      ctx.globalAlpha = a; ctx.fillStyle = '#ffffff';
      lines.forEach((l, k) => ctx.fillText(l, 540, captionY + rise + k * size * 1.18));
    }
    ctx.restore();
  }

  // ---------- controls (page only, never in the video) ----------
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9;display:flex;gap:8px;align-items:center;font:500 13px Figtree,sans-serif;color:#e8ebf4';
  bar.innerHTML = '<button style="font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #3a4360;background:#182033;color:inherit;cursor:pointer">● Record</button><span></span>';
  document.body.appendChild(bar);
  const btn = bar.querySelector('button'), msg = bar.querySelector('span');
  const say = s => { msg.textContent = s; };
  btn.addEventListener('click', () => record());
  addEventListener('keydown', e => { if (e.key === 'r' && !recording) record(); });

  function restart() { o.reset(); idx = 0; t0 = performance.now(); holdUntil = 0; }
  function preview(now) {
    if (recording) return;
    if (holdUntil) { if (now > holdUntil) restart(); }
    else {
      const want = Math.min(N, Math.floor((now - t0) / 1000 * fps));
      while (idx < want) o.tick(idx++);
      if (idx >= N) holdUntil = now + 1500;
    }
    o.render(); overlay(idx / fps);
    say(`preview ${(idx / fps).toFixed(1)} / ${o.seconds} s`);
    raf = requestAnimationFrame(preview);
  }

  const post = (url, body) => fetch(url, { method: 'POST', body }).then(r => r.json());
  async function record() {
    if (recording) return;
    recording = true; cancelAnimationFrame(raf); btn.disabled = true;
    const result = { name: o.name, frames: N };
    try {
      await ready;
      o.reset();
      for (let i = 0; i < N; i++) {
        o.tick(i); o.render(); overlay(i / fps);
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.93));
        const r = await post(`/__rec/frame?name=${o.name}&i=${i}`, blob);
        if (r.error) throw new Error(r.error);
        if (i % 10 === 0) say(`recording frame ${i} / ${N}`);
      }
      say('making the MP4…');
      const r = await post(`/__rec/done?name=${o.name}&fps=${fps}`, '');
      if (r.error) throw new Error(r.error);
      result.file = r.file; say('saved ' + r.file);
    } catch (e) { result.error = String(e); say('failed: ' + e); }
    recording = false; btn.disabled = false; window.__rec.last = result;
    restart(); raf = requestAnimationFrame(preview);
    return result;
  }

  // test pictures at chosen times (seconds), saved as shorts/_frames/<name>-stills/00000.jpg …
  async function stills(times) {
    if (recording) return;
    recording = true; cancelAnimationFrame(raf);
    await ready;
    o.reset();
    let i = 0, k = 0;
    for (const t of times) {
      const m = Math.round(t * fps);
      while (i < m) o.tick(i++);
      o.render(); overlay(i / fps);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
      await post(`/__rec/frame?name=${o.name}-stills&i=${k++}`, blob);
    }
    recording = false; restart(); raf = requestAnimationFrame(preview);
    return k;
  }

  const ready = document.fonts.load('700 76px "Bricolage Grotesque"').catch(() => {});
  ready.then(() => { restart(); raf = requestAnimationFrame(preview); });
  window.__rec = { record, stills, N, fps, last: null };
};
})();
