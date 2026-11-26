"""나스닥 선물 앱 아이콘 — 짙은 남색→보라 그라데이션, 캔들 + 오른쪽 매물대 막대, 아래 '나스닥 선물'.
사용: python make_icon.py OUT_DIR"""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
FONT = r'C:\Windows\Fonts\malgunbd.ttf'
C1, C2 = (12, 20, 52), (88, 46, 160)
UP, DOWN, VP, POC = (255, 92, 92), (120, 170, 255), (255, 255, 255), (255, 200, 61)


def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw(S, maskable):
    g = Image.new('RGB', (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            px[x, y] = lerp(C1, C2, (x + y) / 126)
    im = g.resize((S, S), Image.BICUBIC).convert('RGBA')
    d = ImageDraw.Draw(im, 'RGBA')
    k = 0.70 if maskable else 1.0
    u = S * k / 100; o = (S - S * k) / 2
    X = lambda v: o + v * u
    # 매물대(오른쪽 가로 막대)
    for y, w, col in [(22, 10, VP), (30, 16, VP), (38, 24, POC), (46, 18, VP), (54, 11, VP), (62, 6, VP)]:
        d.rounded_rectangle([X(86 - w), X(y - 3), X(86), X(y + 3)], radius=1.5 * u, fill=col + (200 if col == VP else 245,))
    # 캔들
    cs = [(16, 58, 50, 46, 62), (26, 50, 42, 38, 54), (36, 42, 47, 36, 52), (46, 46, 36, 32, 50), (56, 36, 26, 20, 40)]
    for x, op, cl, hi, lo in cs:
        col = UP if cl < op else DOWN
        d.line([(X(x), X(hi)), (X(x), X(lo))], fill=col, width=max(2, int(1.6 * u)))
        d.rounded_rectangle([X(x - 3.4), X(min(op, cl)), X(x + 3.4), X(max(op, cl))], radius=1.2 * u, fill=col)
    f = ImageFont.truetype(FONT, int(13 * u))
    d.text((S / 2, o + 84 * u), '나스닥 선물', font=f, fill=(255, 255, 255), anchor='mm')
    if not maskable:
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
        im.putalpha(m)
    return im


draw(192, False).save(OUT + '/icon-192.png')
draw(512, False).save(OUT + '/icon-512.png')
draw(512, True).save(OUT + '/icon-maskable-512.png')
print('ok')
