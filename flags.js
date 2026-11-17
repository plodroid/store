/* Small inline flags (SVG, 3:2). Emoji flags don't exist on Windows, so these are drawn here. */
const star = (cx, cy, r, fill) => {
  const p = [...Array(10)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * .4 : r; return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`; });
  return `<polygon points="${p.join(" ")}" fill="${fill}"/>`;
};
const bands = (dir, ...c) => c.map((f, i) => dir === "v" ? `<rect x="${i * 60 / c.length}" width="${60 / c.length + .3}" height="40" fill="${f}"/>` : `<rect y="${i * 40 / c.length}" width="60" height="${40 / c.length + .3}" fill="${f}"/>`).join("");
const FLAGS = {
  gb: `<rect width="60" height="40" fill="#012169"/><path d="M0 0 60 40M60 0 0 40" stroke="#fff" stroke-width="8"/><path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="13"/><path d="M30 0v40M0 20h60" stroke="#C8102E" stroke-width="8"/>`,
  us: `${[...Array(7)].map((_, i) => `<rect y="${i * 40 / 7}" width="60" height="${40 / 7 + .2}" fill="${i % 2 ? "#fff" : "#B22234"}"/>`).join("")}<rect width="27" height="23" fill="#3C3B6E"/>${[...Array(12)].map((_, i) => `<circle cx="${5 + (i % 4) * 6}" cy="${5 + Math.floor(i / 4) * 6.5}" r="1.3" fill="#fff"/>`).join("")}`,
  fr: bands("v", "#0055A4", "#fff", "#EF4135"),
  it: bands("v", "#009246", "#fff", "#CE2B37"),
  de: bands("h", "#000", "#DD0000", "#FFCE00"),
  es: `<rect width="60" height="40" fill="#AA151B"/><rect y="10" width="60" height="20" fill="#F1BF00"/>`,
  dz: `<rect width="30" height="40" fill="#006233"/><rect x="30" width="30" height="40" fill="#fff"/><circle cx="30" cy="20" r="10" fill="#D21034"/><circle cx="33" cy="20" r="8.2" fill="#fff"/>${star(34.5, 20, 6.2, "#D21034")}`,
  tr: `<rect width="60" height="40" fill="#E30A17"/><circle cx="23" cy="20" r="10" fill="#fff"/><circle cx="26" cy="20" r="8" fill="#E30A17"/>${star(35, 20, 5.2, "#fff")}`,
  in: `${bands("h", "#FF9933", "#fff", "#138808")}<circle cx="30" cy="20" r="4.6" fill="none" stroke="#000080" stroke-width="1.2"/><circle cx="30" cy="20" r="1" fill="#000080"/>`,
  pk: `<rect width="60" height="40" fill="#01411C"/><rect width="15" height="40" fill="#fff"/><circle cx="37" cy="20" r="9.5" fill="#fff"/><circle cx="40.5" cy="18" r="8" fill="#01411C"/>${star(44, 14.5, 4, "#fff")}`,
  bd: `<rect width="60" height="40" fill="#006A4E"/><circle cx="27" cy="20" r="10" fill="#F42A41"/>`,
  pl: bands("h", "#fff", "#DC143C"),
  ro: bands("v", "#002B7F", "#FCD116", "#CE1126"),
  pt: `<rect width="60" height="40" fill="#FF0000"/><rect width="24" height="40" fill="#006600"/><circle cx="24" cy="20" r="7" fill="#FFD700" stroke="#FF0000" stroke-width="1.5"/><circle cx="24" cy="20" r="3.2" fill="#fff"/>`,
  nl: bands("h", "#AE1C28", "#fff", "#21468B"),
  ru: bands("h", "#fff", "#0039A6", "#D52B1E"),
  cn: `<rect width="60" height="40" fill="#DE2910"/>${star(11, 11, 6.5, "#FFDE00")}${star(22, 4.5, 2.2, "#FFDE00")}${star(26, 10, 2.2, "#FFDE00")}${star(26, 17, 2.2, "#FFDE00")}${star(22, 22.5, 2.2, "#FFDE00")}`,
  jp: `<rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#BC002D"/>`,
  kr: `<rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="10" fill="#CD2E3A"/><path d="M20 20a10 10 0 0 0 20 0a5 5 0 0 0-10 0a5 5 0 0 1-10 0z" fill="#0047A0"/><g stroke="#000" stroke-width="2"><path d="M8 7l5 -3M9 10l5 -3M47 4l5 3M46 7l5 3M8 33l5 3M9 30l5 3M47 36l5 -3M46 33l5 -3"/></g>`,
  id: bands("h", "#CE1126", "#fff"),
};
/* more flags, for the phone-login country list */
Object.assign(FLAGS, {
  ie: bands("v", "#169B62", "#fff", "#FF883E"),
  be: bands("v", "#000", "#FAE042", "#ED2939"),
  ch: `<rect width="60" height="40" fill="#DA291C"/><path d="M26 9h8v10h10v8H34v10h-8V27H16v-8h10z" fill="#fff" transform="translate(0 -3) scale(1 .85) translate(0 5.5)"/>`,
  ca: `<rect width="60" height="40" fill="#fff"/><rect width="15" height="40" fill="#D52B1E"/><rect x="45" width="15" height="40" fill="#D52B1E"/><path d="M30 8l2.6 5 3-1-1 7 4-3 1 2.5-5.5 4.5.8 2.5-5-.6V33h-1.8v-6.1l-5 .6.8-2.5L21 19.5l1-2.5 4 3-1-7 3 1z" fill="#D52B1E"/>`,
  ma: `<rect width="60" height="40" fill="#C1272D"/><path d="M30 11l3.2 9.9H43l-8.3 6 3.2 9.9-8-6.1-8 6.1 3.2-9.9-8.3-6h9.8z" fill="none" stroke="#006233" stroke-width="1.6" transform="translate(0 -3) scale(1 .95) translate(0 2)"/>`,
  tn: `<rect width="60" height="40" fill="#E70013"/><circle cx="30" cy="20" r="11" fill="#fff"/><circle cx="30" cy="20" r="8" fill="#E70013"/><circle cx="31.6" cy="20" r="6.4" fill="#fff"/>${star(31.4, 20, 4, "#E70013")}`,
  eg: `${bands("h", "#CE1126", "#fff", "#000")}<rect x="26" y="15" width="8" height="10" rx="2" fill="#C09300"/>`,
  sa: `<rect width="60" height="40" fill="#006C35"/><rect x="14" y="13" width="32" height="3" rx="1.5" fill="#fff"/><rect x="16" y="19" width="28" height="3" rx="1.5" fill="#fff"/><rect x="17" y="27" width="26" height="2.4" rx="1.2" fill="#fff"/>`,
  ae: `<rect width="60" height="40" fill="#fff"/><rect x="15" width="45" height="13.4" fill="#00732F"/><rect x="15" y="26.6" width="45" height="13.4" fill="#000"/><rect width="15" height="40" fill="#FF0000"/>`,
});
FLAGS.au = `<rect width="60" height="40" fill="#012169"/><svg width="30" height="20" viewBox="0 0 60 40">${FLAGS.gb}</svg>${star(15, 30, 5, "#fff")}${star(44, 8, 2.6, "#fff")}${star(52, 18, 2.6, "#fff")}${star(44, 31, 2.6, "#fff")}${star(37, 19, 2.6, "#fff")}`;

export const flag = code => `<svg class="fl" viewBox="0 0 60 40" aria-hidden="true" focusable="false">${FLAGS[code] || FLAGS.gb}</svg>`;
