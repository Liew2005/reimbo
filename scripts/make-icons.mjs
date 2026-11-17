// Generates public/icon.svg + PNG icons from the Reimbo mark. Run: node scripts/make-icons.mjs
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

const BODY = 'M84 320V282Q84 266 102 262L152 252L192 206Q198 198 210 198H304Q318 198 326 208L362 252L412 262Q430 266 430 284V320H386A44 44 0 0 0 298 320H214A44 44 0 0 0 126 320Z'
const ZIG = 'M66 380' + 'l15.5 12l15.5 -12'.repeat(12)
const mark = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
   <g transform="translate(0,-26)" fill="none" stroke="#f6f5f1" stroke-linecap="round" stroke-linejoin="round">
    <g stroke-width="16"><path d="${BODY}"/><path stroke-width="12" d="M184 250L212 222H298L330 250ZM254 222V250"/>
     <circle cx="342" cy="320" r="22"/><circle cx="170" cy="320" r="22"/>
     <circle cx="342" cy="320" r="4" fill="#f6f5f1" stroke="none"/><circle cx="170" cy="320" r="4" fill="#f6f5f1" stroke="none"/></g>
    <path stroke-width="12" d="${ZIG}"/>
   </g></g>`
const svg = (radius, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="#14532d"/>${mark(scale)}</svg>`

writeFileSync('public/icon.svg', svg(115, 1))
const png = (s, name, radius, scale) => sharp(Buffer.from(svg(radius, scale))).resize(s, s).png().toFile(`public/${name}`)
await png(192, 'icon-192.png', 115, 1)
await png(512, 'icon-512.png', 115, 1)
await png(512, 'icon-maskable-512.png', 0, 0.8)
await png(180, 'apple-touch-icon.png', 0, 0.9)
console.log('icons written')
