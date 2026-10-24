# Draw the installer artwork (Windows installer side panel and header, MSI banner and dialog,
# macOS disk image background) from the Motown AI logo, in src-tauri/installer/.
#
#   python3 scripts/make-installer-art.py ../knowly ../motownai-mobile   (needs Pillow)
#
# The logo comes from the website repo; the DM Sans font from the mobile app repo.
from PIL import Image, ImageDraw, ImageFont
import sys, os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K=os.path.join(sys.argv[1], 'app/static/images/')
OUT=os.path.join(ROOT, 'src-tauri/installer/')
FONT=os.path.join(sys.argv[2], 'assets/fonts/DMSansDisplay-Bold.ttf')
FONT_SB=os.path.join(sys.argv[2], 'assets/fonts/DMSansDisplay-SemiBold.ttf')
mark=Image.open(K+'motown-mark.png').convert('RGBA')
logo_dark=Image.open(K+'new-logo-dark.png').convert('RGBA')   # white text, for dark backgrounds
logo_light=Image.open(K+'new-logo.png').convert('RGBA')       # black text, for light backgrounds
INDIGO=(75,59,214); INDIGO_DEEP=(46,33,150); INK=(13,13,13)

def gradient(w,h,top,bottom):
    im=Image.new('RGB',(w,h))
    d=ImageDraw.Draw(im)
    for y in range(h):
        t=y/max(1,h-1)
        d.line([(0,y),(w,y)],fill=tuple(int(top[i]+(bottom[i]-top[i])*t) for i in range(3)))
    return im

def paste(bg,img,box_w,x,y):
    r=box_w/img.width
    im=img.resize((int(img.width*r),int(img.height*r)),Image.LANCZOS)
    bg.paste(im,(int(x),int(y)),im)
    return im.size

def wordmark(im,panel_w,y):
    d=ImageDraw.Draw(im)
    f=ImageFont.truetype(FONT,24); t='Motown AI'
    d.text(((panel_w-d.textlength(t,font=f))/2,y),t,font=f,fill=(255,255,255))
    f2=ImageFont.truetype(FONT_SB,9); t2='STUDY SMARTER WITH AI'
    d.text(((panel_w-d.textlength(t2,font=f2))/2,y+34),t2,font=f2,fill=(208,203,255))

# NSIS welcome/finish sidebar: 164x314
sb=gradient(164,314,INDIGO,INDIGO_DEEP)
paste(sb,mark,88,(164-88)/2,72)
wordmark(sb,164,184)
sb.save(OUT+'nsis-sidebar.bmp')

# NSIS header: 150x57, white with the mark on the right
hd=Image.new('RGB',(150,57),(255,255,255))
paste(hd,mark,41,150-41-8,8)
hd.save(OUT+'nsis-header.bmp')

# WiX (MSI) banner: 493x58, white with the logo on the right
bn=Image.new('RGB',(493,58),(255,255,255))
paste(bn,mark,40,493-40-12,9)
bn.save(OUT+'msi-banner.bmp')

# WiX dialog: 493x312, indigo panel on the left (text area is the white right side)
dl=Image.new('RGB',(493,312),(255,255,255))
dl.paste(gradient(164,312,INDIGO,INDIGO_DEEP),(0,0))
paste(dl,mark,88,(164-88)/2,70)
wordmark(dl,164,180)
dl.save(OUT+'msi-dialog.bmp')

# macOS DMG window background: 660x400
bg=gradient(660,400,(22,20,36),(13,13,13))
d=ImageDraw.Draw(bg)
paste(bg,logo_dark,170,(660-170)/2,34)
f=ImageFont.truetype(FONT_SB,17)
txt='Drag Motown AI into Applications'
w=d.textlength(txt,font=f)
d.text(((660-w)/2,326),txt,font=f,fill=(205,203,225))
# arrow between the app (x=180) and Applications (x=480) icons, at y=220
d.line([(262,220),(392,220)],fill=(124,108,250),width=4)
d.polygon([(392,210),(410,220),(392,230)],fill=(124,108,250))
bg.save(OUT+'dmg-background.png')
bg.resize((1320,800),Image.LANCZOS).save(OUT+'dmg-background@2x.png')
print('ok')
