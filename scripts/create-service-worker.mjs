import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("Pass the client output directory.");
const files = (await readdir(join(output, "assets"))).sort();
const assets = files.map((file) => "/assets/" + file);
const paths = [
  "/",
  "/privacy",
  "/data-deletion",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  ...assets,
];
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(join(output, "assets", file)));
const cache = "runo-" + hash.digest("hex").slice(0, 12);
const source = `const CACHE=${JSON.stringify(cache)}; const ASSETS=${JSON.stringify(paths)};
self.addEventListener('install', event => event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(ASSETS);await self.skipWaiting()})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const req=event.request;const url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.endsWith('.data')||url.pathname==='/sw.js') return; if(req.mode==='navigate'){if(!['/','/privacy','/data-deletion'].includes(url.pathname))return;event.respondWith(fetch(req).catch(async()=>await caches.match(url.pathname)||Response.error()));return} if(!ASSETS.includes(url.pathname))return;event.respondWith(caches.match(req,{ignoreVary:true}).then(cached=>cached||fetch(req))); });`;
await writeFile(join(output, "sw.js"), source);
console.log("Generated service worker with", paths.length, "cached paths");
