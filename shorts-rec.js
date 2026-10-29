/* Record mode for YouTube Shorts. A widget loads this only when its URL has ?record.
   The widget draws on a 1080×1920 canvas and passes:
     name     video file name (shorts/<name>.mp4)
     seconds  video length; fps (default 30)
     reset()  start the scene from the beginning (same seed every time)
     tick(i)  advance the scene by one video frame (i = frame number)
     render() draw the scene
     captions [{ from, to, text, size?, y?, color? }] in seconds, "\n" breaks lines; captionY in pixels
              (a caption's own y, up to ~850, overrides captionY; color defaults to white)
     music    optional { file, start, fade }: a recording in shorts/music/, played from <start> s into the
              file and fading out over the last <fade> s of the video
   This file plays a looping preview with the captions, and on "Record" (or the R key) steps through every
   frame WITHOUT captions and sends it to .claude/record-server.py, which makes a clean video
   (shorts/_clean/<name>.mp4). Then the captions are drawn once each as pictures and laid over the clean
   video (shorts/<name>.mp4), and the music goes under it.
   __rec.captions() redoes the captions (and music) on the clean video in about a minute, so changing a
   caption's words or timing needs no re-recording. __rec.music() only redoes the music.
   No site address in the video (Zak's choice): the link goes in the YouTube description. */
(() => {
const FADE = 0.35, RISE = 18, BAND = 900;   // caption fade (s), slide-up (px), height of the caption pictures (px)

window.ShortsRec = function (o) {
  const fps = o.fps || 30, N = Math.round(o.seconds * fps);
  const cv = o.canvas, ctx = cv.getContext('2d');
  const captionY = o.captionY || 300;
  let idx = 0, t0 = 0, recording = false, raf = 0, holdUntil = 0;

  function drawCaption(g, c, a, rise) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 22;
    const lines = c.text.split('\n');
    let size = c.size || 76;
    g.font = `700 ${size}px "Bricolage Grotesque", sans-serif`;
    const widest = Math.max(...lines.map(l => g.measureText(l).width));
    if (widest > 960) { size = Math.floor(size * 960 / widest); g.font = `700 ${size}px "Bricolage Grotesque", sans-serif`; }
    g.globalAlpha = a; g.fillStyle = c.color || '#ffffff';
    const y0 = c.y || captionY;
    lines.forEach((l, k) => g.fillText(l, 540, y0 + rise + k * size * 1.18));
    g.restore();
  }
  function overlay(t) {   // the preview and stills draw the captions live, the same way the video shows them
    for (const c of o.captions) {
      if (t < c.from || t > c.to) continue;
      const fin = c.from > 0 ? Math.min(1, (t - c.from) / FADE) : 1;   // a caption at 0 s is there from the first frame
      drawCaption(ctx, c, Math.min(fin, (c.to - t) / FADE, 1), (1 - fin) * RISE);
    }
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
        o.tick(i); o.render();
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.93));
        const r = await post(`/__rec/frame?name=${o.name}&i=${i}`, blob);
        if (r.error) throw new Error(r.error);
        if (i % 10 === 0) say(`recording frame ${i} / ${N}`);
      }
      say('making the MP4…');
      const r = await post(`/__rec/done?name=${o.name}&fps=${fps}&clean=1`, '');
      if (r.error) throw new Error(r.error);
      result.file = await captions(); say('saved ' + result.file);
    } catch (e) { result.error = String(e); say('failed: ' + e); }
    recording = false; btn.disabled = false; window.__rec.last = result;
    restart(); raf = requestAnimationFrame(preview);
    return result;
  }

  async function music() {
    const m = o.music;
    say('adding the music…');
    const r = await post(`/__rec/music?name=${o.name}&file=${m.file}&start=${m.start || 0}&fade=${m.fade || 3}`, '');
    if (r.error) throw new Error(r.error);
    say('music added to ' + r.file);
    return r;
  }

  // each caption drawn once at full strength on a transparent picture; the server fades and slides it in
  async function captions() {
    await ready;
    const c2 = document.createElement('canvas'); c2.width = 1080; c2.height = BAND;
    const g = c2.getContext('2d');
    say('drawing the captions…');
    for (let k = 0; k < o.captions.length; k++) {
      g.clearRect(0, 0, 1080, BAND); drawCaption(g, o.captions[k], 1, 0);
      const r = await post(`/__rec/caption?name=${o.name}&i=${k}`, await new Promise(r => c2.toBlob(r, 'image/png')));
      if (r.error) throw new Error(r.error);
    }
    say('laying the captions over the clean video…');
    const times = o.captions.map(c => ({ from: c.from, to: c.to }));   // a caption that runs past the end stays fully on
    const r = await post(`/__rec/captions?name=${o.name}`, JSON.stringify({ captions: times, fade: FADE, rise: RISE }));
    if (r.error) throw new Error(r.error);
    if (o.music) await music();
    say('captions done: ' + r.file);
    return r.file;
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
  window.__rec = { record, captions, stills, music, N, fps, last: null };
};
})();
