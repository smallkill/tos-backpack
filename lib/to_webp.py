import sys, io, warnings
from PIL import Image
# 上游圖檔視為不可信:只接受 PNG,解壓縮炸彈(超過像素上限)一律當錯誤
Image.MAX_IMAGE_PIXELS = 4096 * 4096
warnings.simplefilter('error', Image.DecompressionBombWarning)
size = int(sys.argv[1])
im = Image.open(io.BytesIO(sys.stdin.buffer.read()), formats=['PNG']).convert('RGBA')
im = im.resize((size, size), Image.LANCZOS)
out = io.BytesIO()
im.save(out, 'WEBP', quality=78, method=6)
sys.stdout.buffer.write(out.getvalue())
