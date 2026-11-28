// Logo options in the style of the Set app's Spotter mark: one solid character in the accent,
// cream eyes glancing sideways, an ink face, leaning 6 degrees and cropped flat by whatever it sits on.
// Usage: node docs/logo-options/make.mjs <out.html>   (writes the SVGs beside this script)
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const css = readFileSync(new URL("../../src/ui/editor.css", import.meta.url), "utf8");
const token = (n) => new RegExp(`--${n}: (#[0-9a-f]{6})`).exec(css)[1];
const ACCENT = token("accent"); // Ember
const CREAM = token("surface");
const INK = token("ink");
const SEA = token("page");

const mix = (a, b, t) =>
  "#" +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0"))
    .join("");
const FIELD = mix(ACCENT, CREAM, 0.15);

// Spotter's eye: cream white with an ink pupil up and to the right.
const eye = (x, y, r) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${CREAM}"/>` +
  `<circle cx="${x + r * 0.42}" cy="${y - r * 0.28}" r="${r * 0.52}" fill="${INK}"/>`;
const stroke = (w) => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
// Soft corners like the board's pieces: the body is drawn with a round-joined outline in its own colour.
const body = (d, fill = ACCENT, soft = 6) =>
  `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="${soft}" stroke-linejoin="round"/>`;
const lean = (inner, deg = -6) => `<g transform="rotate(${deg} 50 108)">${inner}</g>`;
const smile = (x0, y0, w) => `<path d="M${x0} ${y0} Q${x0 + w * 0.53} ${y0 + w * 0.42} ${x0 + w} ${y0 - w * 0.1}" ${stroke(3)}/>`;

// Each option: id, name, rationale, mark (100-unit frame, base at y=108), header box, icon box.
const MARK = "16 2 68 74";
const ICON = "-15.4 -30.3 130.7 130.7";
// An option with a tag is a variant of the lettered option above it; the rest take letters in order.
const options = [
  {
    id: "settler",
    name: "Settler",
    why: "A settlement piece that is, well, unsettled: peeking up and glancing sideways. The name's pun as a character.",
    art: lean(
      body("M21 108 V46 L50 15 L79 46 V108 Z") + eye(39, 58, 9) + eye(61, 58, 9) +
        smile(44.6, 76, 16.8),
    ),
    mark: "14 6 72 82", // taller than MARK: the roof puts the face lower, and MARK's bottom edge cut the mouth
    icon: ICON,
  },
  {
    id: "settler-squat",
    tag: "A2",
    name: "Squat settler",
    why: "The Settler at the game piece's proportions: a short, wide house, whole and centred in the frame instead of running off the bottom.",
    art: `<g transform="rotate(-6 50 52)">` +
      body("M22 80 V52 L50 22 L78 52 V80 Z") + eye(40, 57, 8.5) + eye(60, 57, 8.5) + smile(45.2, 71, 15) + `</g>`,
    mark: "12 18 76 68",
    icon: "-14 -12 128 128",
  },
  {
    id: "tile",
    name: "Tile",
    why: "A whole hex tile with a face, tipped a little off true. The board in one shape.",
    art: `<g transform="rotate(-6 50 50)">` +
      body("M14 50 L32 18.8 H68 L86 50 L68 81.2 H32 Z") + eye(38.6, 44, 9) + eye(61.4, 44, 9) + smile(44.6, 61, 16.8) + `</g>`,
    mark: "9 13 82 74",
    icon: "-14 -14 128 128",
  },
  {
    id: "robber",
    name: "Robber",
    why: "The robber pawn in Ember, an ink bandit mask over its eyes and a sly sideways look. The one piece every player has an opinion about.",
    art: lean(
      body("M36 54 Q30 80 21 108 H79 Q70 80 64 54 Z") +
        `<rect x="31" y="47" width="38" height="11" rx="5.5" fill="${ACCENT}"/>` +
        `<circle cx="50" cy="31" r="22" fill="${ACCENT}"/>` +
        `<rect x="27" y="22" width="46" height="15" rx="7.5" fill="${INK}"/>` +
        eye(41, 29.5, 6.2) + eye(59, 29.5, 6.2) + smile(45, 41.5, 12),
    ),
    mark: MARK,
    icon: ICON,
  },
  {
    id: "token",
    name: "Lucky six",
    why: "A number token whose smile is the five pips a 6 carries. The odds, the thing the app is about, worn as a grin.",
    art: lean(
      `<circle cx="50" cy="46" r="33" fill="${ACCENT}"/>` + eye(38.6, 38, 9) + eye(61.4, 38, 9) +
        [[34, 54], [41.5, 59.5], [50, 61.5], [58.5, 59.5], [66, 54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${INK}"/>`).join(""),
    ),
    mark: "15 2 70 76",
    icon: "-14 -21 128 128",
  },
  {
    id: "city",
    name: "City",
    why: "The city piece, tower and lower wing, with the face on the tower. Reads as building up, the goal of every turn.",
    art: lean(
      body("M14 108 V38 L33 17 L52 38 V56 H86 V108 Z") + eye(26, 46, 7.5) + eye(42, 46, 7.5) + smile(29, 62, 13),
    ),
    mark: "10 2 80 74",
    icon: ICON,
  },
  {
    id: "dice",
    name: "Snake eyes",
    why: "Two dice that each rolled a one, the pip drawn as an eye so the pair reads as a face. Dice are the moment the whole table watches.",
    art:
      `<g transform="rotate(-10 30 46)"><rect x="12" y="28" width="36" height="36" rx="8" fill="${ACCENT}"/>${eye(30, 46, 10)}</g>` +
      `<g transform="rotate(8 70 48)"><rect x="52" y="30" width="36" height="36" rx="8" fill="${ACCENT}"/>${eye(70, 48, 10)}</g>`,
    mark: "8 20 84 54",
    icon: "-14 -17 128 128",
  },
];

const svg = (art, box, backdrop) => {
  const [x, y, w, h] = box.split(" ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">` +
    (backdrop ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${backdrop}"/>` : "") +
    art + `</svg>`
  );
};
const sized = (s, w, h) => s.replace("<svg ", `<svg width="${w}" height="${h}" aria-hidden="true" `);

let letter = 65;
for (const o of options) o.tag ??= String.fromCharCode(letter++);
for (const o of options) {
  writeFileSync(new URL(`${o.id}-mark.svg`, dir), svg(o.art, o.mark) + "\n");
  writeFileSync(new URL(`${o.id}-icon.svg`, dir), svg(o.art, o.icon, FIELD) + "\n");
}

// The page: one column per option with the same four views.
const markAt = (o, px) => {
  const [, , w, h] = o.mark.split(" ").map(Number);
  return sized(svg(o.art, o.mark), Math.round((px * w) / h), px);
};
const col = (tag, name, why, icon) => `
<article class="col">
  <header><p class="tag">${tag}</p><h2>${name}</h2></header>
  <p class="why">${why}</p>
  <figure><div class="squircle big">${icon(1024)}</div><figcaption>App icon, iOS mask</figcaption></figure>
  <figure><div class="pair">
    <div class="wall light"><div class="app"><div class="squircle s60">${icon(60)}</div><span>Unsettled</span></div></div>
    <div class="wall dark"><div class="app"><div class="squircle s60">${icon(60)}</div><span>Unsettled</span></div></div>
  </div><figcaption>Home screen, 60 pt</figcaption></figure>
</article>`;
const row = (name, mark) => `
<div class="hrow"><p class="hname">${name}</p>
  <div class="hdr sea big">${mark(52)}<b>Unsettled</b></div>
  <div class="hdr sea">${mark(30)}<b>Unsettled</b></div>
  <div class="hdr light">${mark(30)}<b>Unsettled</b></div>
  <div class="hdr dark">${mark(30)}<b>Unsettled</b></div>
</div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsettled Logo Options</title>
<style>
:root { --bg: #ece7dc; --surface: #fffdf8; --fg: #2d2924; --muted: #776f64; --line: #e3d9c5;
  --sans: -apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #14120f; --surface: #1f1c18; --fg: #f1ece3; --muted: #a39b8f; --line: #36312a; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #14120f; --surface: #1f1c18; --fg: #f1ece3; --muted: #a39b8f; --line: #36312a; color-scheme: dark }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans); padding: 28px 16px 48px; }
.top { max-width: 72ch; display: grid; gap: 6px; margin-bottom: 24px; }
h1 { font-size: 28px; line-height: 1.15; margin: 0; letter-spacing: -0.01em; }
.top p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-items: start; }
.col { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: grid; gap: 14px; min-width: 0; grid-template-rows: auto 6.2em auto auto; }
.col header { display: grid; gap: 2px; }
.tag { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
h2 { margin: 0; font-size: 17px; line-height: 1.25; }
.why { margin: 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
figure { margin: 0; display: grid; gap: 6px; }
figcaption { font-size: 11px; color: var(--muted); }
.squircle { border-radius: 22.37%; overflow: hidden; display: block; box-shadow: 0 0 0 1px rgba(0,0,0,.06); }
.squircle svg, .squircle img { display: block; width: 100%; height: 100%; }
.squircle.big { aspect-ratio: 1; }
.squircle.s60 { width: 60px; height: 60px; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.wall { border-radius: 10px; height: 104px; display: grid; place-items: center; }
.wall.light { background: linear-gradient(160deg, #f7e6d4 0%, #dfe7f5 55%, #c9d8ee 100%); }
.wall.dark { background: linear-gradient(160deg, #23283c 0%, #11131c 60%, #07080c 100%); }
.app { display: grid; justify-items: center; gap: 4px; }
.app span { font-size: 12px; line-height: 1; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.55); }
h3 { font-size: 20px; margin: 36px 0 4px; }
.sub { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
.hrows { display: grid; gap: 8px; overflow-x: auto; }
.hrow { display: grid; grid-template-columns: 110px 340px repeat(3, 240px); gap: 8px; align-items: center; }
.hname { margin: 0; font-size: 13px; font-weight: 600; }
.hdr { border-radius: 10px; height: 52px; display: flex; align-items: center; gap: 8px; padding-inline: 14px; overflow: hidden; }
.hdr b { font: 800 31px/1 Georgia, serif; letter-spacing: -.04em; white-space: nowrap; margin-top: -2px; }
.hdr.big { height: 76px; gap: 10px; }
.hdr.big b { font-size: 44px; }
.hdr svg, .hdr img { flex: none; }
.hdr.sea { background: ${SEA}; color: ${CREAM}; }
.hdr.light { background: ${CREAM}; color: ${INK}; }
.hdr.dark { background: #1a1815; color: ${CREAM}; }
</style></head><body>
<section class="top">
  <h1>Unsettled logo options</h1>
  <p>Characters in the style of Set's Spotter (two-tone): one solid shape in the app's Ember accent <span class="sw" style="background:${ACCENT}"></span> <code>${ACCENT}</code>, cream eyes glancing sideways, an ink face, leaning slightly, and (for the pieces) cropped flat by whatever they sit on. The icon ground is 15% Ember over the app's cream <span class="sw" style="background:${FIELD}"></span> <code>${FIELD}</code>, as Spotter sits on 15% of its green. Each column shows the app icon, the icon at home-screen size on a light and a dark wallpaper, with the headers at real size below.</p>
</section>
<main class="grid">
${options.map((o) => col(`Option ${o.tag}`, o.name, o.why, (px) => sized(svg(o.art, o.icon, FIELD), px, px))).join("")}
</main>
<h3>Header at real size</h3>
<p class="sub">The desktop header (52 px mark, 44 px title) and the phone brand row (30 px mark, 31 px title) on the sea blue they sit on, then the phone row on light and dark.</p>
<section class="hrows">
${options.map((o) => row(`${o.tag}: ${o.name}`, (px) => markAt(o, px))).join("")}
</section>
</body></html>
`;
writeFileSync(process.argv[2], html);
