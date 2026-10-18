from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
root=Path(__file__).resolve().parent
f=instantiateVariableFont(TTFont(root/'assets/fonts/Manrope.ttf'),{'wght':700},inplace=False)
glyphs=f.getGlyphSet(); cmap=f.getBestCmap(); units=f['head'].unitsPerEm
scale=72/units; x=118; paths=[]
for ch in 'Tándem':
 name=cmap[ord(ch)]; pen=SVGPathPen(glyphs)
 glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,x,78)))
 paths.append('<path d="'+pen.getCommands()+'"/>')
 x+=glyphs[name].width*scale-1.1
mark='<path d="M12 8H44V88H28V28H8V12Q8 8 12 8Z"/><path d="M52 8H84Q88 8 88 12V28H68V88H52Z"/>'
for name,color in [('ink','#132C3A'),('white','#FFFFFF')]:
 body=f'<g fill="{color}">{mark}{"".join(paths)}</g>'
 (root/f'assets/tandem-logo-{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{round(x+8)}" height="104" viewBox="0 0 {round(x+8)} 104" role="img" aria-label="Tándem">{body}</svg>')
 (root/f'assets/tandem-mark-{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Tándem"><g fill="{color}">{mark}</g></svg>')
(root/'assets/tandem-app-icon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Tándem"><rect width="512" height="512" rx="104" fill="#132C3A"/><g transform="translate(96 96) scale(3.333333)" fill="#FFFFFF">{mark}</g></svg>')
print('Outlined logo and five SVG assets created.')
