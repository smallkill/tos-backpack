import sys, io
from PIL import Image
size = int(sys.argv[1])
im = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGBA')
im = im.resize((size, size), Image.LANCZOS)
out = io.BytesIO()
im.save(out, 'WEBP', quality=78, method=6)
sys.stdout.buffer.write(out.getvalue())
