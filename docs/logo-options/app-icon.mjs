// Builds the shipped icons from the squat settler (option A2) in one of its shapes:
// the iOS AppIcon.icon layer (a PNG, since Icon Composer drops the SVG's round joins) and fill,
// the tab icon, and the four web install icons. The header mark in src/ui/Brand.tsx is drawn by hand.
// Usage: node docs/logo-options/app-icon.mjs [current|upright|level|slant]   (needs rsvg-convert; oxipng if present)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

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
// The iOS layer: the mark alone on a 1024 canvas, at the web icon's scale and place; the tile is the icon's fill.
mkdirSync(new URL("ios/App/App/AppIcon.icon/Assets/", root), { recursive: true });
png(svg("-14 -12 128 128", art), 1024, "ios/App/App/AppIcon.icon/Assets/settler.png");
const iconJson = new URL("ios/App/App/AppIcon.icon/icon.json", root);
const icon = JSON.parse(readFileSync(iconJson, "utf8"));
icon.fill = { solid: `srgb:${[1, 3, 5].map((i) => (parseInt(TILE.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000` };
writeFileSync(iconJson, JSON.stringify(icon, null, 2) + "\n");
// The web icons carry the tile themselves. The mark sits inside the maskable safe circle as drawn.
const tiled = svg("-14 -12 128 128", `<rect x="-14" y="-12" width="128" height="128" fill="${TILE}"/>${art}`);
for (const [px, name] of [[180, "apple-touch-icon"], [192, "icon-192"], [512, "icon-512"], [512, "icon-maskable-512"]]) png(tiled, px, `public/${name}.png`);

const pngs = ["ios/App/App/AppIcon.icon/Assets/settler.png", "public/apple-touch-icon.png", "public/icon-192.png", "public/icon-512.png", "public/icon-maskable-512.png"];
try {
  execFileSync("oxipng", ["-q", "-o", "4", "--strip", "safe", ...pngs.map((p) => new URL(p, root).pathname)]);
} catch {
  console.warn("oxipng not found; PNGs left uncompressed");
}
