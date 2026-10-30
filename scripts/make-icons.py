#!/usr/bin/env python3
"""Draws the Bee Hive app icons (a striped hexagon bee on honey) for the website and both Android apps.
Run from the repo root:  python3 scripts/make-icons.py   (needs Pillow + Playwright's chromium)"""
import math, glob, os, io
from PIL import Image
from playwright.sync_api import sync_playwright

HONEY, INK, CREAM, LIGHT, AMBER = "#F5B800", "#2A2008", "#FFF8E6", "#FFE08A", "#9A6200"

def hexpts(cx, cy, r):
    return " ".join(f"{cx + r * math.cos(math.radians(-90 + 60 * i)):.1f},{cy + r * math.sin(math.radians(-90 + 60 * i)):.1f}" for i in range(6))

def bee(body, stripe, wing, k=1.0):
    """the bee: wings + hexagon body with two stripes, centred on the 512 canvas, scaled by k"""
    hx = hexpts(256, 282, 118)
    return f'''<g transform="translate(256 256) scale({k}) translate(-256 -246)">
<ellipse cx="176" cy="142" rx="72" ry="32" transform="rotate(-24 176 142)" fill="{wing}"/>
<ellipse cx="336" cy="142" rx="72" ry="32" transform="rotate(24 336 142)" fill="{wing}"/>
<clipPath id="h"><polygon points="{hx}"/></clipPath>
<polygon points="{hx}" fill="{body}"/>
<g clip-path="url(#h)" fill="{stripe}"><rect x="120" y="244" width="272" height="34"/><rect x="120" y="306" width="272" height="34"/></g>
</g>'''

def svg(bg=None, corner=0.22, body=INK, stripe=LIGHT, wing=CREAM, k=1.0, circle=False):
    rect = ""
    if bg:
        rect = f'<circle cx="256" cy="256" r="256" fill="{bg}"/>' if circle else f'<rect width="512" height="512" rx="{512 * corner:.0f}" fill="{bg}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{rect}{bee(body, stripe, wing, k)}</svg>'

pw = sync_playwright().start(); br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 512, "height": 512})
def png(s, size):
    pg.set_content(f'<body style="margin:0;background:transparent">{s}</body>')
    im = Image.open(io.BytesIO(pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": 512, "height": 512}))).convert("RGBA")
    return im.resize((size, size), Image.LANCZOS)

# website
site = svg(HONEY, k=1.12)
open("icon.svg", "w").write(site + "\n")
png(site, 512).save("icon-512.png"); png(site, 192).save("icon-192.png")

# the two Android apps (customer = honey, owner = dark so you can tell them apart)
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
LOOK = {"customer": dict(bg=HONEY, body=INK, stripe=LIGHT, wing=CREAM), "owner": dict(bg=INK, body=HONEY, stripe=AMBER, wing=CREAM)}
for app, L in LOOK.items():
    res = f"apps/{app}/android/app/src/main/res"
    if not os.path.isdir(res): continue
    kw = dict(body=L["body"], stripe=L["stripe"], wing=L["wing"])
    for name, k in DENS.items():
        png(svg(L["bg"], 0.22, k=1.12, **kw), round(48 * k)).save(f"{res}/mipmap-{name}/ic_launcher.png")
        png(svg(L["bg"], circle=True, k=1.0, **kw), round(48 * k)).save(f"{res}/mipmap-{name}/ic_launcher_round.png")
        png(svg(None, k=0.78, **kw), round(108 * k)).save(f"{res}/mipmap-{name}/ic_launcher_foreground.png")
    open(f"{res}/values/ic_launcher_background.xml", "w").write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{L["bg"]}</color>\n</resources>\n')
    for f in glob.glob(f"{res}/drawable*/splash.png"):          # launch screen: cream with the icon in the middle
        w, h = Image.open(f).size
        canvas = Image.new("RGBA", (w, h), (255, 248, 230, 255))
        m = png(svg(L["bg"], 0.22, k=1.12, **kw), round(min(w, h) * 0.34))
        canvas.paste(m, ((w - m.width) // 2, (h - m.height) // 2), m)
        canvas.convert("RGB").save(f)
br.close(); pw.stop()
print("icons done")
