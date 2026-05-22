# Render the "See you in N HOUR(S)!" reminder headline to a PNG using
# Hub-191-Display. Transparent background — composed over the email's
# sky-blue panel.
#
# Usage:
#   python backend/scripts/render-reminder-headline.py            # 4h (default)
#   python backend/scripts/render-reminder-headline.py --hours 3
#   python backend/scripts/render-reminder-headline.py --all      # 4,3,2,1

import argparse
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = ROOT / 'frontend' / 'public' / 'fonts' / 'Hub-191-Display.otf'
PUBLIC_DIR = ROOT / 'frontend' / 'public'

W = 1200
TARGET_TEXT_W = 1100

WHITE = (255, 255, 255, 255)
NAVY = (26, 58, 74, 255)        # #1a3a4a
RED = (255, 57, 58, 255)        # #ff393a


def render(hours: int) -> Path:
    suffix_word = 'HOUR!' if hours == 1 else 'HOURS!'
    prefix = 'See you in '
    suffix = f'{hours} {suffix_word}'
    full = prefix + suffix

    # Auto-fit font size to TARGET_TEXT_W.
    font_size = 160
    while font_size > 40:
        f = ImageFont.truetype(str(FONT_PATH), font_size)
        tmp = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        if tmp.textlength(full, font=f) <= TARGET_TEXT_W:
            break
        font_size -= 4

    font = ImageFont.truetype(str(FONT_PATH), font_size)
    prefix_w = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(prefix, font=font)
    suffix_w = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(suffix, font=font)
    total_w = prefix_w + suffix_w

    asc, desc = font.getmetrics()
    text_h = asc + desc
    H = text_h + 60

    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    x_prefix = (W - total_w) // 2
    x_suffix = x_prefix + prefix_w
    y = (H - text_h) // 2 - 8

    for off in (4, 6, 8):
        draw.text((x_prefix + off, y + off), prefix, font=font, fill=NAVY)
    draw.text((x_prefix, y), prefix, font=font, fill=WHITE)

    for off in (4, 6, 8):
        draw.text((x_suffix + off, y + off), suffix, font=font, fill=WHITE)
    draw.text((x_suffix, y), suffix, font=font, fill=RED)

    filename = f"reminder-see-you-in-{hours}-{'hour' if hours == 1 else 'hours'}.png"
    out = PUBLIC_DIR / filename
    img.save(out, 'PNG', optimize=True)
    print(f'Wrote {out} ({W}x{H}, font {font_size}px)')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=int, default=4)
    ap.add_argument('--all', action='store_true')
    args = ap.parse_args()

    if args.all:
        for h in (4, 3, 2, 1):
            render(h)
    else:
        render(args.hours)


if __name__ == '__main__':
    main()
