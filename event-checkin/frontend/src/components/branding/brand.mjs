export const BRAND_GREEN = '#254F43'
export const BRAND_MARK = 'M16 0h18a2 2 0 0 1 2 2v32a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V16A16 16 0 0 1 16 0Z'
export const BRAND_F = 'M12 7h14v5h-8v4h7v5h-7v7h-6Z'
export function brandSvg({ markOnly = false, inverse = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${markOnly ? 36 : 110} 36" width="${markOnly ? 36 : 110}" height="36" role="img" aria-label="Festio"><path fill="${BRAND_GREEN}" d="${BRAND_MARK}"/><path fill="#fff" d="${BRAND_F}"/>${markOnly ? '' : `<text x="44" y="26" fill="${inverse ? '#fff' : '#252a27'}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="400" letter-spacing="-1.2">Festio</text>`}</svg>`
}
