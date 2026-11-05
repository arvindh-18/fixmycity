"""Draw simple, clearly illustrative before/after photos for the demo build (no stock photos needed).

Each category has a 'before' (the problem) and an 'after' (fixed) scene on a street with a little random
variety (buildings, trees, light). They are drawings, not real photos, so the demo can't mislead anyone.
"""
import io
import random
from datetime import datetime

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 720, 540
HORIZON = 210


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _sky(d: ImageDraw.ImageDraw, night: bool, rng: random.Random):
    top, bottom = ((18, 24, 48), (48, 58, 92)) if night else ((150 + rng.randint(-15, 15), 196, 226), (226, 236, 238))
    for y in range(HORIZON + 1):
        t = y / HORIZON
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))


def _buildings(d: ImageDraw.ImageDraw, night: bool, rng: random.Random):
    x = -20
    palette = [(214, 196, 168), (196, 178, 160), (226, 214, 190), (184, 196, 190), (232, 200, 170), (208, 186, 196)]
    while x < W:
        w, h = rng.randint(70, 140), rng.randint(60, 150)
        col = rng.choice(palette)
        if night:
            col = tuple(c // 3 for c in col)
        d.rectangle([x, HORIZON - h, x + w, HORIZON + 6], fill=col)
        for wy in range(HORIZON - h + 12, HORIZON - 8, 26):
            for wx in range(x + 10, x + w - 14, 24):
                lit = night and rng.random() < 0.45
                d.rectangle([wx, wy, wx + 12, wy + 14], fill=(250, 214, 120) if lit else tuple(max(0, c - 40) for c in col))
        x += w + rng.randint(4, 18)
    # roadside trees
    for _ in range(rng.randint(1, 3)):
        tx = rng.choice([rng.randint(10, 150), rng.randint(W - 150, W - 10)])
        d.rectangle([tx - 4, HORIZON - 10, tx + 4, HORIZON + 30], fill=(92, 64, 40))
        g = (40, 72, 46) if night else (rng.randint(60, 90), rng.randint(120, 150), 70)
        d.ellipse([tx - 34, HORIZON - 70, tx + 34, HORIZON], fill=g)


def _road(d: ImageDraw.ImageDraw, night: bool, smooth: bool = True):
    asphalt = (52, 54, 58) if night else (104, 106, 110)
    shoulder = (60, 56, 50) if night else (176, 160, 132)
    d.rectangle([0, HORIZON, W, H], fill=shoulder)
    d.polygon([(W * 0.42, HORIZON), (W * 0.58, HORIZON), (W + 120, H), (-120, H)], fill=asphalt)
    # centre dashes in perspective
    for i in range(7):
        t0, t1 = i / 7, i / 7 + 0.06
        y0, y1 = HORIZON + (H - HORIZON) * t0 ** 1.6, HORIZON + (H - HORIZON) * t1 ** 1.6
        w0, w1 = 1 + 6 * t0, 1 + 6 * t1
        d.polygon([(W / 2 - w0, y0), (W / 2 + w0, y0), (W / 2 + w1, y1), (W / 2 - w1, y1)], fill=(236, 226, 180))
    if not smooth:
        for _ in range(40):
            x, y = random.randint(80, W - 80), random.randint(HORIZON + 40, H - 10)
            d.line([(x, y), (x + random.randint(-30, 30), y + random.randint(-8, 8))], fill=(70, 70, 72), width=2)


def _timestamp(img: Image.Image, when: datetime):
    d = ImageDraw.Draw(img)
    text = when.strftime("%d %b %Y  %H:%M")
    f = _font(15)
    bbox = d.textbbox((0, 0), text, font=f)
    x, y = W - (bbox[2] - bbox[0]) - 14, H - (bbox[3] - bbox[1]) - 14
    d.text((x + 1, y + 1), text, font=f, fill=(0, 0, 0))
    d.text((x, y), text, font=f, fill=(255, 196, 64))


def _blob(d, cx, cy, rx, ry, fill, rng, n=14):
    import math
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 0.75 + rng.random() * 0.4
        pts.append((cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r))
    d.polygon(pts, fill=fill)


# ---- category scenes ---------------------------------------------------------------------------

def _pothole(d, rng, fixed):
    for _ in range(rng.randint(2, 4)):
        cx, cy = rng.randint(220, 500), rng.randint(330, 480)
        rx, ry = rng.randint(40, 90), rng.randint(16, 32)
        if fixed:
            d.rectangle([cx - rx - 6, cy - ry - 4, cx + rx + 6, cy + ry + 4], fill=(62, 64, 68))
        else:
            _blob(d, cx, cy, rx, ry, (44, 40, 38), rng)
            _blob(d, cx, cy + 3, rx * 0.7, ry * 0.55, (96, 120, 134), rng)  # muddy water
            d.arc([cx - rx, cy - ry, cx + rx, cy + ry], 200, 340, fill=(140, 132, 120), width=3)


def _garbage(d, rng, fixed):
    if fixed:
        d.rounded_rectangle([560, 300, 640, 420], 8, fill=(46, 125, 80))
        d.rectangle([552, 290, 648, 306], fill=(36, 100, 64))
        return
    colors = [(30, 30, 30), (60, 90, 160), (200, 200, 190), (170, 60, 50), (90, 140, 70), (220, 180, 60)]
    for _ in range(40):
        cx, cy = rng.randint(470, 700), rng.randint(300, 470)
        _blob(d, cx, cy, rng.randint(14, 34), rng.randint(10, 24), rng.choice(colors), rng, 10)
    for _ in range(30):
        x, y = rng.randint(300, 700), rng.randint(330, 530)
        d.rectangle([x, y, x + 6, y + 4], fill=rng.choice(colors))


def _streetlight(d, rng, fixed):
    x = 470
    d.rectangle([x, 120, x + 8, 470], fill=(70, 74, 80))
    d.line([(x + 4, 124), (x - 70, 108)], fill=(70, 74, 80), width=7)
    lamp = [x - 96, 98, x - 52, 118]
    if fixed:
        glow = Image.new("L", (W, H), 0)
        g = ImageDraw.Draw(glow)
        g.polygon([(x - 74, 118), (x - 240, 520), (x + 120, 520)], fill=90)
        d.bitmap((0, 0), glow.filter(ImageFilter.GaussianBlur(18)), fill=(255, 220, 140))
        d.ellipse(lamp, fill=(255, 236, 150))
    else:
        d.ellipse(lamp, fill=(90, 92, 96))


def _water(d, rng, fixed):
    d.rectangle([0, 440, W, 456], fill=(90, 96, 100))  # pipe along the road
    if fixed:
        d.rectangle([330, 434, 372, 462], fill=(40, 120, 200))  # clamp
        return
    _blob(d, 360, 470, 300, 50, (120, 160, 196), rng, 20)
    for i in range(14):
        d.line([(352, 440), (352 + rng.randint(-90, 90), 440 - rng.randint(60, 150))], fill=(170, 210, 240), width=3)


def _drainage(d, rng, fixed):
    d.rectangle([0, 470, W, 520], fill=(120, 116, 108))
    if fixed:
        for x in range(0, W, 60):
            d.rectangle([x + 2, 470, x + 58, 518], fill=(150, 148, 140), outline=(100, 98, 92), width=2)
        return
    d.rectangle([0, 476, W, 514], fill=(70, 62, 40))
    _blob(d, 300, 450, 240, 40, (92, 84, 54), rng, 18)
    for _ in range(25):
        x, y = rng.randint(80, 560), rng.randint(420, 500)
        d.ellipse([x, y, x + 8, y + 5], fill=(140, 130, 90))


def _tree(d, rng, fixed):
    if fixed:
        d.ellipse([90, 420, 150, 446], fill=(110, 80, 50))  # stump at the side
        return
    d.polygon([(40, 400), (60, 380), (640, 440), (626, 466)], fill=(96, 66, 40))
    for _ in range(12):
        cx, cy = rng.randint(200, 640), rng.randint(360, 470)
        _blob(d, cx, cy, rng.randint(30, 60), rng.randint(20, 40), (rng.randint(50, 80), rng.randint(110, 140), 60), rng)


def _footpath(d, rng, fixed):
    for row in range(3):
        for col in range(9):
            x, y = col * 80, 430 + row * 36
            if not fixed and rng.random() < 0.35:
                d.polygon([(x + 4, y + 4), (x + 70, y + 10), (x + 50, y + 32), (x + 10, y + 30)], fill=(90, 80, 66))
                d.line([(x + 10, y + 6), (x + 60, y + 30)], fill=(60, 54, 46), width=2)
            else:
                d.rectangle([x + 2, y + 2, x + 78, y + 34], fill=(196, 186, 170) if fixed else (170, 160, 146),
                            outline=(140, 132, 120))


def _traffic(d, rng, fixed):
    x = 160
    d.rectangle([x, 150, x + 10, 470], fill=(60, 60, 64))
    d.rounded_rectangle([x - 22, 110, x + 32, 250], 10, fill=(30, 30, 32))
    for i, col in enumerate([(220, 50, 40), (240, 180, 40), (40, 200, 90)]):
        on = fixed and i == 2
        d.ellipse([x - 12, 120 + i * 42, x + 22, 154 + i * 42], fill=col if on else (70, 70, 72))


def _other(d, rng, fixed):
    if fixed:
        return
    for i in range(3):
        cx = 280 + i * 70
        d.polygon([(cx, 380), (cx - 22, 450), (cx + 22, 450)], fill=(240, 120, 40))
        d.rectangle([cx - 14, 410, cx + 14, 420], fill=(250, 250, 250))


SCENES = {"pothole": _pothole, "garbage": _garbage, "streetlight": _streetlight, "water": _water,
          "drainage": _drainage, "tree": _tree, "footpath": _footpath, "traffic": _traffic, "other": _other}


def draw(category: str, fixed: bool, seed: int, when: datetime) -> bytes:
    rng = random.Random(seed)
    night = category == "streetlight"
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    _sky(d, night, rng)
    _buildings(d, night, rng)
    _road(d, night)
    SCENES.get(category, _other)(d, rng, fixed)
    # A touch of blur + grain so it reads like a phone photo at thumbnail size.
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    _timestamp(img, when)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=72, optimize=True)
    return out.getvalue()
