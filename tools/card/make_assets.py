"""Builds the card's image files: the Apple Wallet pass images (assets/<slug>-card/pass/) from the team photo and the bar mark,
and the QR codes (tools/card/out/) for the printed card, assets/<slug>-card/qr.svg for the on-screen code and the Wallet/NFC links.
Usage: python3 tools/card/make_assets.py shawnee shawnee-mercier"""
import sys, os, json
from PIL import Image, ImageDraw, ImageOps
import qrcode, qrcode.image.svg
SLUG, PHOTO = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CARD = os.path.join(ROOT, 'assets', SLUG + '-card'); PASS = os.path.join(CARD, 'pass'); OUT = os.path.join(ROOT, 'tools', 'card', 'out'); os.makedirs(PASS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
DEEP, TEAL, BRONZE, MINT, PAPER = (12, 50, 52), (20, 112, 110), (166, 124, 61), (143, 212, 203), (251, 249, 245)
def mark(px, bg=True):
    """The five-bar mark from the site favicon, drawn on a 32-unit grid."""
    im = Image.new('RGBA', (px, px), DEEP + (255,) if bg else (0, 0, 0, 0)); d = ImageDraw.Draw(im); s = px / 32
    for i, (x, y, h) in enumerate([(5, 20, 7), (10, 16, 11), (15, 12, 15), (20, 8, 19), (25, 5, 22)]):
        col = BRONZE if i == 2 else (TEAL if bg else MINT)
        d.rectangle([round(x * s), round(y * s), round((x + 3) * s) - 1, round((y + h) * s) - 1], fill=col + (255,))
    return im
for n, px in (('icon.png', 29), ('icon@2x.png', 58), ('icon@3x.png', 87)): mark(px * 4).resize((px, px), Image.LANCZOS).save(os.path.join(PASS, n))
# the logo sits on the pass's deep-teal background: bars only, transparent, mint and bronze
for n, px in (('logo.png', 50), ('logo@2x.png', 100), ('logo@3x.png', 150)): mark(px * 4, bg=False).resize((px, px), Image.LANCZOS).save(os.path.join(PASS, n))
photo = Image.open(os.path.join(ROOT, 'assets', 'about', 'team', PHOTO + '.jpg')).convert('RGB')
for n, px in (('thumbnail.png', 90), ('thumbnail@2x.png', 180), ('thumbnail@3x.png', 270)): ImageOps.fit(photo, (px, px), Image.LANCZOS).save(os.path.join(PASS, n))
# QR codes. Error correction M survives print wear and a small logo-free code; quiet zone 4 modules as the standard asks.
base = 'https://thecapitalrow.com/' + SLUG
def tagged(src, content=None):
    u = f'{base}?utm_source={src}&utm_medium=business-card&utm_campaign={SLUG}-card'
    return u + (f'&utm_content={content}' if content else '')
urls = {k: tagged(k) for k in ('wallet', 'nfc', 'qr-print', 'qr-screen', 'share', 'vcard')}
json.dump(urls, open(os.path.join(OUT, 'urls.json'), 'w'), indent=1)
def qr(data, name):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4); q.add_data(data); q.make(fit=True)
    q.make_image(fill_color=(12, 50, 52), back_color='white').save(os.path.join(OUT, name + '.png'))
    big = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=20); big.add_data(data); big.make(fit=True)
    big.make_image(fill_color=(12, 50, 52), back_color='white').save(os.path.join(OUT, name + '-large.png'))
    svg = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, image_factory=qrcode.image.svg.SvgPathImage); svg.add_data(data); svg.make(fit=True)
    svg.make_image().save(os.path.join(OUT, name + '.svg'))
    return q.modules_count
print({k: qr(v, SLUG + '-' + k) for k, v in urls.items() if k in ('qr-print', 'qr-screen')})
# the on-screen code the card page shows, served from the site
import shutil; shutil.copy(os.path.join(OUT, SLUG + '-qr-screen.svg'), os.path.join(CARD, 'qr.svg'))
print(json.dumps(urls, indent=1))
