#!/usr/bin/env python3
"""Draws the Bee Hive app icons (a honey hexagon) for the website and both Android apps.
Run from the repo root:  python3 scripts/make-icons.py   (needs Pillow)"""
import math, glob, os
from PIL import Image, ImageDraw

EMERALD, DEEP, HONEY, CREAM = (22, 121, 90), (14, 66, 52), (244, 184, 64), (244, 243, 238)
SS = 4  # draw 4x bigger, then shrink: smooth edges

def hexagon(cx, cy, r, rot=30):
    return [(cx + r * math.cos(math.radians(rot + 60 * i)), cy + r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]

def mark(size, bg=None, corner=0.0, scale=1.0, ring=EMERALD):
    """The hexagon mark. bg=None gives a transparent canvas (used for the adaptive-icon foreground)."""
    s = size * SS
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * corner), fill=bg + (255,))
    c, R = s / 2, s * 0.30 * scale
    d.polygon(hexagon(c, c, R), fill=HONEY + (255,))
    d.polygon(hexagon(c, c, R * 0.52), fill=ring + (255,))
    d.polygon(hexagon(c, c, R * 0.30), fill=HONEY + (255,))
    return im.resize((size, size), Image.LANCZOS)

def circle(im):
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m); return out

# website
mark(512, EMERALD, 0.22).save("icon-512.png"); mark(192, EMERALD, 0.22).save("icon-192.png")
poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in hexagon(256, 256, 154))
inner = " ".join(f"{x:.1f},{y:.1f}" for x, y in hexagon(256, 256, 80)); core = " ".join(f"{x:.1f},{y:.1f}" for x, y in hexagon(256, 256, 46))
open("icon.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="113" fill="#16795A"/><polygon points="{poly}" fill="#F4B840"/><polygon points="{inner}" fill="#16795A"/><polygon points="{core}" fill="#F4B840"/></svg>\n')

# the two Android apps
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for app, bg in (("customer", EMERALD), ("owner", DEEP)):
    res = f"apps/{app}/android/app/src/main/res"
    if not os.path.isdir(res): continue
    for name, k in DENS.items():
        legacy = mark(round(48 * k), bg, 0.22, ring=bg)
        legacy.save(f"{res}/mipmap-{name}/ic_launcher.png")
        circle(mark(round(48 * k), bg, 0.5, ring=bg)).save(f"{res}/mipmap-{name}/ic_launcher_round.png")
        mark(round(108 * k), None, 0, 1.15, ring=bg).save(f"{res}/mipmap-{name}/ic_launcher_foreground.png")
    hexv = "%02X%02X%02X" % bg
    open(f"{res}/values/ic_launcher_background.xml", "w").write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#{hexv}</color>\n</resources>\n')
    for f in glob.glob(f"{res}/drawable*/splash.png"):          # launch screen: cream with the mark in the middle
        w, h = Image.open(f).size
        canvas = Image.new("RGBA", (w, h), CREAM + (255,))
        m = mark(round(min(w, h) * 0.34), bg, 0.22, ring=bg)
        canvas.paste(m, ((w - m.width) // 2, (h - m.height) // 2), m)
        canvas.convert("RGB").save(f)
print("icons done")
