# One-shot: render the "See you in 4 HOURS!" reminder headline to a PNG
# using Hub-191-Display. Transparent background — composed over the email's
# sky-blue panel.
#
# Output: frontend/public/reminder-see-you-in-4-hours.png

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = ROOT / 'frontend' / 'public' / 'fonts' / 'Hub-191-Display.otf'
OUT_PATH = ROOT / 'frontend' / 'public' / 'reminder-see-you-in-4-hours.png'

W = 1200          # 2x for crisp display at 600px in email
TARGET_TEXT_W = 1100
PREFIX = 'See you in '
SUFFIX = '4 HOURS!'
FULL = PREFIX + SUFFIX

WHITE = (255, 255, 255, 255)
NAVY = (26, 58, 74, 255)        # #1a3a4a
RED = (255, 57, 58, 255)        # #ff393a

# Auto-fit font size to TARGET_TEXT_W.
font_size = 160
while font_size > 40:
    f = ImageFont.truetype(str(FONT_PATH), font_size)
    tmp = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    w = tmp.textlength(FULL, font=f)
    if w <= TARGET_TEXT_W:
        break
    font_size -= 4

font = ImageFont.truetype(str(FONT_PATH), font_size)
prefix_w = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(PREFIX, font=font)
suffix_w = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(SUFFIX, font=font)
total_w = prefix_w + suffix_w

# Use bbox for accurate height + shadow padding.
asc, desc = font.getmetrics()
text_h = asc + desc
H = text_h + 60  # extra room for shadow stack

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

x_prefix = (W - total_w) // 2
x_suffix = x_prefix + prefix_w
y = (H - text_h) // 2 - 8  # nudge up slightly to balance descender

# Shadow stack (navy for white text part). 3 layers like the inline CSS.
for off in (4, 6, 8):
    draw.text((x_prefix + off, y + off), PREFIX, font=font, fill=NAVY)
draw.text((x_prefix, y), PREFIX, font=font, fill=WHITE)

# Shadow stack (white for red text part).
for off in (4, 6, 8):
    draw.text((x_suffix + off, y + off), SUFFIX, font=font, fill=WHITE)
draw.text((x_suffix, y), SUFFIX, font=font, fill=RED)

img.save(OUT_PATH, 'PNG', optimize=True)
print(f'Wrote {OUT_PATH} ({W}x{H}, font {font_size}px)')
