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
export const flag = code => `<svg class="fl" viewBox="0 0 60 40" aria-hidden="true" focusable="false">${FLAGS[code] || FLAGS.gb}</svg>`;
