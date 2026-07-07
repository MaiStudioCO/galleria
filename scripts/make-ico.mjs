// Renders scripts/icon.svg into a multi-size Windows .ico (PNG-encoded entries).
// Usage: node scripts/make-ico.mjs <icon.svg> <out.ico>
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'

const [svgPath, outIco] = process.argv.slice(2)
if (!svgPath || !outIco) {
  console.error('usage: node make-ico.mjs <icon.svg> <out.ico>')
  process.exit(1)
}
const svg = readFileSync(svgPath)
const sizes = [16, 24, 32, 48, 64, 128, 256]

const images = []
for (const size of sizes) {
  images.push({ size, data: await sharp(svg, { density: 400 }).resize(size, size).png().toBuffer() })
}

// ICO container: 6-byte header + 16-byte directory entry per image + concatenated PNG data.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: 1 = icon
header.writeUInt16LE(images.length, 4)

const dir = Buffer.alloc(16 * images.length)
let offset = header.length + dir.length
const blobs = []
images.forEach((img, i) => {
  const e = i * 16
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0) // width (0 means 256)
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1) // height
  dir.writeUInt8(0, e + 2) // palette count
  dir.writeUInt8(0, e + 3) // reserved
  dir.writeUInt16LE(1, e + 4) // color planes
  dir.writeUInt16LE(32, e + 6) // bits per pixel
  dir.writeUInt32LE(img.data.length, e + 8) // bytes of image data
  dir.writeUInt32LE(offset, e + 12) // offset of image data
  offset += img.data.length
  blobs.push(img.data)
})

writeFileSync(outIco, Buffer.concat([header, dir, ...blobs]))
console.log(`wrote ${outIco} (${images.length} sizes)`)
