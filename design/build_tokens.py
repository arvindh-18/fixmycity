"""Regenerate frontend/src/design-system/tokens.css from the Commons tokens.json.
Run from the repository root:  python design/build_tokens.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
t = json.loads((root / "design/commons-design-system/tokens.json").read_text())
light = [f"  --{x['name']}: {x['value']['light']};" for x in t["color"]["tokens"]]
dark = [f"  --{x['name']}: {x['value']['dark']};" for x in t["color"]["tokens"]]
other = [f"  --font-serif: {t['type']['families']['serif']};", f"  --font-sans: {t['type']['families']['sans']};"]
for g in ("spacing", "radius", "stroke"):
    other += [f"  --{x['name']}: {x['value']};" for x in t[g]["tokens"]]
css = "/* Generated from design/commons-design-system/tokens.json — do not edit by hand.\n   Regenerate with: python design/build_tokens.py */\n\n"
css += ":root {\n  color-scheme: light;\n" + "\n".join(light) + "\n" + "\n".join(other) + "\n}\n\n"
css += "/* Dark theme: the same roles, deepened tints. Follows the system setting unless the user picks one. */\n"
css += "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {\n    color-scheme: dark;\n" + "\n".join("  " + l for l in dark) + "\n  }\n}\n"
css += ":root[data-theme=\"dark\"] {\n  color-scheme: dark;\n" + "\n".join(dark) + "\n}\n"
(root / "frontend/src/design-system/tokens.css").write_text(css)
print("wrote tokens.css")
