// Offline helper ("service worker") for the installable app version of the site.
// It saves every page on the phone. Pages always try the internet first, so updates show up
// right away, and the saved copy is used when there's no signal (or the network is very slow).
//
// When you add a widget: add its folder name to WIDGETS below (it needs previews/<name>.jpg too)
// and bump VERSION, so phones that already have the app download the new list.

const VERSION = "v3";
const CACHE = "math-widgets-" + VERSION;
const FONTS = "math-widgets-fonts";
const SLOW_MS = 4000;

const WIDGETS = [
  "mandelbrot-descent", "rational-map-explorer", "kaleidoscope",
  "gravity-well", "gravity-well-3d", "hooke-newton-squaring-map",
  "double-pendulum-flip-map", "bifurcation-mandelbrot",
  "schrodinger-sandbox", "schrodinger-sandbox-2d", "inside-the-proton",
  "fourier-studio", "three-body-chaos-map", "padic-warp",
];
const FILES = [
  "./", "index.html", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png",
  ...WIDGETS.flatMap(w => [w + "/index.html", "previews/" + w + ".jpg"]),
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map(u => new Request(u, { cache: "reload" })));
    await saveFonts(cache); // best effort: never stops the install
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") e.respondWith(fontFirst(req));
  else if (url.origin === location.origin) e.respondWith(networkFirst(req));
});

// Saved copy of a page; "folder/" and "folder/index.html" are the same page.
async function lookup(cache, req) {
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const url = new URL(req.url);
  if (url.pathname.endsWith("/")) return cache.match(url.href + "index.html", { ignoreSearch: true });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(no, SLOW_MS))]);
  } catch {
    const hit = await lookup(cache, req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      try { return await net; } catch { return (await cache.match("index.html")) || Response.error(); }
    }
    return net;
  }
}

// Fonts never change at a given address, so the saved copy is used whenever there is one.
async function fontFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

// Save each page's Google Fonts (Latin letters only) so the app looks right offline too.
async function saveFonts(cache) {
  try {
    const fonts = await caches.open(FONTS);
    const sheets = new Set();
    for (const w of ["index.html", ...WIDGETS.map(w => w + "/index.html")]) {
      const res = await cache.match(w);
      if (!res) continue;
      for (const m of (await res.text()).matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/g)) sheets.add(m[1].replace(/&amp;/g, "&"));
    }
    for (const href of sheets) {
      if (await fonts.match(href)) continue;
      const res = await fetch(href);
      if (!res.ok) continue;
      const css = await res.clone().text();
      await fonts.put(href, res);
      for (const block of css.split("/* ").filter(b => b.startsWith("latin */"))) {
        const m = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
        if (m && !(await fonts.match(m[1]))) {
          const f = await fetch(m[1]);
          if (f.ok) await fonts.put(m[1], f);
        }
      }
    }
  } catch { /* fonts are a nice-to-have; the system font is used if they're missing */ }
}
