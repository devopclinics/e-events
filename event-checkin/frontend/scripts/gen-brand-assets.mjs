import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { brandSvg } from '../src/components/branding/brand.mjs'
const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
mkdirSync(publicDir + 'brand', { recursive: true })
for (const [name, options] of [['festio-logo.svg', {}], ['festio-logo-light.svg', { inverse: true }], ['festio-mark.svg', { markOnly: true }]]) {
  writeFileSync(publicDir + 'brand/' + name, brandSvg(options) + '\n')
}
writeFileSync(publicDir + 'favicon.svg', brandSvg({ markOnly: true }) + '\n')
writeFileSync(publicDir + 'guesthub-icon.svg', brandSvg({ markOnly: true }) + '\n')
