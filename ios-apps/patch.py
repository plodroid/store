#!/usr/bin/env python3
"""Run after `npx cap add ios` (see .github/workflows/ios-apps.yml): makes the generated Xcode project match the Android app.
usage: patch.py <customer|owner>   (cwd = ios-apps/<app>)"""
import plistlib, shutil, sys, os, re, json
app = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
APP = "ios/App/App"
name = json.load(open("capacitor.config.json"))["appName"]

# ── Info.plist ──
p = f"{APP}/Info.plist"
d = plistlib.load(open(p, "rb"))
d["CFBundleDisplayName"] = name
d["UIRequiredDeviceCapabilities"] = ["arm64"]                       # the template says armv7, which modern phones don't list
d["ITSAppUsesNonExemptEncryption"] = False
why = {"customer": "Bee Hive uses your location to fill in your delivery address.",
       "owner": "Bee Hive Owner uses your location for turn-by-turn directions and, while a delivery is on its way, so the customer can watch you arrive."}[app]
d["NSLocationWhenInUseUsageDescription"] = why
d["NSLocationAlwaysAndWhenInUseUsageDescription"] = why
d["UIStatusBarStyle"] = "UIStatusBarStyleDarkContent"
d["UIViewControllerBasedStatusBarAppearance"] = True

# Google sign-in (owner): the iOS client id from GoogleService-Info.plist + its reversed id as a URL scheme
gsi = f"{HERE}/{app}/GoogleService-Info.plist"
if os.path.exists(gsi):
    g = plistlib.load(open(gsi, "rb"))
    rev = g.get("REVERSED_CLIENT_ID")
    if rev and "PASTE" not in rev:
        d["CFBundleURLTypes"] = [{"CFBundleURLSchemes": [rev]}]
        d["GIDClientID"] = g.get("CLIENT_ID", "")
    print("GoogleService-Info.plist:", "real" if rev and "PASTE" not in rev else "placeholder (Google sign-in disabled)")
plistlib.dump(d, open(p, "wb"))

# ── icon + splash ──
shutil.copy(f"{HERE}/assets/AppIcon-512@2x.png", f"{APP}/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
for f in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    shutil.copy(f"{HERE}/assets/splash-2732x2732.png", f"{APP}/Assets.xcassets/Splash.imageset/{f}")

# ── never build for anything older than iOS 13 or newer-only (Capacitor 6 default is 13.0; keep it explicit) ──
pb = "ios/App/App.xcodeproj/project.pbxproj"
s = open(pb).read()
s = re.sub(r"IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;", "IPHONEOS_DEPLOYMENT_TARGET = 13.0;", s)
open(pb, "w").write(s)
print("patched", app, "→", name)
