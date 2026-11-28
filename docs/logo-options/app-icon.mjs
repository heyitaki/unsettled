// Builds the shipped icons from the squat settler (option A2) in one of its shapes:
// the iOS app icon, the tab icon, and the four web install icons. The header mark in src/ui/Brand.tsx is drawn by hand.
// The iOS icon is a single flat 1024 PNG in a legacy appiconset, as Set's is: Icon Composer (AppIcon.icon) always gives the tile a thin light edge.
// Usage: node docs/logo-options/app-icon.mjs [current|upright|level|slant]   (needs rsvg-convert; oxipng if present)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const css = readFileSync(new URL("src/ui/editor.css", root), "utf8");
const token = (n) => new RegExp(`--${n}: (#[0-9a-f]{6})`).exec(css)[1];
const EMBER = token("accent");
const CREAM = token("surface");
const INK = token("ink");
// Set's tile lightness and chroma (OKLCH 0.935, 0.025) at Ember's hue, so the tile reads as pale red the way Set's reads as pale green.
const TILE = "#fae4df";

const face =
  [40, 60].map((x) => `<circle cx="${x}" cy="57" r="8.5" fill="${CREAM}"/><circle cx="${x + 3.57}" cy="54.62" r="4.42" fill="${INK}"/>`).join("") +
  `<path d="M45.2 71 Q53.15 77.3 60.2 69.5" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
const body = (d) => `<path d="${d}" fill="${EMBER}" stroke="${EMBER}" stroke-width="6" stroke-linejoin="round"/>`;
const HOUSE = "M22 80 V52 L50 22 L78 52 V80 Z";
const lean = (s) => `<g transform="rotate(-6 50 52)">${s}</g>`;
const SHAPES = {
  // The whole house leans 6 degrees, base included.
  current: lean(body(HOUSE) + face),
  // A: no lean.
  upright: body(HOUSE) + face,
  // B: the leaning house's corners with the right wall run down to the left corner's height, so the base is level.
  level: body("M25.08 82.78 L22.15 54.93 L46.86 22.16 L77.85 49.07 L81.38 82.78 Z") + lean(face),
  // C: sheared, so the walls and roof lean while the base and eaves stay level.
  slant: `<g transform="translate(0 80) skewX(6) translate(0 -80)">${body(HOUSE) + face}</g>`,
};

const shape = process.argv[2] ?? "current";
const art = SHAPES[shape];
if (!art) throw new Error(`unknown shape ${shape}; pick one of ${Object.keys(SHAPES).join(", ")}`);

const svg = (box, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${inner}</svg>\n`;
const png = (source, px, out) =>
  execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), "-o", new URL(out, root).pathname], { input: source });

writeFileSync(new URL("public/favicon.svg", root), svg("12 18 76 68", art));
// The iOS icon and the web icons are the same tiled square. The mark sits inside the maskable safe circle as drawn.
const tiled = svg("-14 -12 128 128", `<rect x="-14" y="-12" width="128" height="128" fill="${TILE}"/>${art}`);
const pngs = [
  [1024, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"],
  [180, "public/apple-touch-icon.png"],
  [192, "public/icon-192.png"],
  [512, "public/icon-512.png"],
  [512, "public/icon-maskable-512.png"],
].map(([px, out]) => (png(tiled, px, out), out));

try {
  execFileSync("oxipng", ["-q", "-o", "4", "--strip", "safe", ...pngs.map((p) => new URL(p, root).pathname)]);
} catch {
  console.warn("oxipng not found; PNGs left uncompressed");
}
