// Renders scripts/icon.svg into the 10 PNGs macOS `iconutil` needs.
// Usage: node scripts/make-icon.mjs <icon.svg> <output.iconset-dir>
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'

const [svgPath, outDir] = process.argv.slice(2)
if (!svgPath || !outDir) {
  console.error('usage: node make-icon.mjs <icon.svg> <iconset-dir>')
  process.exit(1)
}
const svg = readFileSync(svgPath)

// [pixel size, iconutil-mandated filename]
const files = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]

for (const [size, name] of files) {
  const buf = await sharp(svg, { density: 400 }).resize(size, size).png().toBuffer()
  writeFileSync(`${outDir}/${name}`, buf)
}
console.log(`wrote ${files.length} icon sizes to ${outDir}`)
