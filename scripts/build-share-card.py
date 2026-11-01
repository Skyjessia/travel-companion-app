"""Build a typographic share image. QR encodes only the canonical public URL."""
from pathlib import Path
from urllib.request import urlopen
from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics.barcode import qr
URL='https://skyjessia.github.io/travel-companion-app/'
font_path=Path('/tmp/NotoSansCJKsc-Regular.otf')
if not font_path.exists():
    with urlopen('https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',timeout=30) as r:
        font_path.write_bytes(r.read())
def font(size):return ImageFont.truetype(str(font_path),size)
im=Image.new('RGB',(1200,630),'#f8f6f1');d=ImageDraw.Draw(im)
d.rounded_rectangle((30,30,1170,600),radius=28,outline='#e4ddcf',width=2)
d.text((76,62),'T R A V E L   C O M P A N I O N',font=font(24),fill='#406359')
d.text((72,129),'一起规划，',font=font(64),fill='#283f38')
d.text((72,220),'轻松出发。',font=font(64),fill='#283f38')
d.text((78,331),'从计划，到旅途，再到回忆。',font=font(25),fill='#827765')
for x,label in [(78,'AI 一起规划'),(294,'每日路线'),(484,'出发准备')]:
    box=(x,412,x+174,468);d.rounded_rectangle(box,radius=14,fill='#ebe8df')
    tw=d.textbbox((0,0),label,font=font(21))[2];d.text((x+(174-tw)/2,424),label,font=font(21),fill='#635d50')
d.line((78,513,1122,513),fill='#dfd8cb',width=2)
d.text((78,542),'skyjessia.github.io/travel-companion-app/',font=font(23),fill='#51685d')
q=qr.QrCodeWidget(URL);q.qr.make();n=q.qr.getModuleCount();scale=7;quiet=4
size=(n+quiet*2)*scale;left=877;top=156
# A four-module quiet zone is kept intact around the exact QR matrix.
d.rounded_rectangle((left-16,top-16,left+size+16,top+size+16),radius=20,fill='white')
for row in range(n):
 for col in range(n):
  if q.qr.isDark(row,col):
   x=left+(quiet+col)*scale;y=top+(quiet+row)*scale
   d.rectangle((x,y,x+scale-1,y+scale-1),fill='#263d34')
label='扫码，开始一趟旅行';tw=d.textbbox((0,0),label,font=font(23))[2]
d.text((left+(size-tw)/2,top+size+26),label,font=font(23),fill='#635d50')
Path('assets').mkdir(exist_ok=True);im.save('assets/share-card.png',optimize=True)
print('Share card ready, QR payload:',URL)
