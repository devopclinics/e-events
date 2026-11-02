import { BRAND_GREEN, BRAND_MARK, BRAND_F } from './brand.mjs'
import './FestioLogo.css'

// Shared Festio identity. Event/organizer logos are separate assets.
export default function FestioLogo({ size = 34, markOnly = false, inverse = false, className = '', style, ...props }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={markOnly ? '0 0 36 36' : '0 0 110 36'}
    width={markOnly ? size : size * 110 / 36} height={size}
    className={`festio-logo${inverse ? ' festio-logo-inverse' : ''} ${className}`.trim()}
    role="img" aria-label="Festio" style={style} {...props}>
    <path fill={BRAND_GREEN} d={BRAND_MARK}/>
    <path fill="#fff" d={BRAND_F}/>
    {!markOnly && <text x="44" y="26" fill="currentColor" fontFamily="Arial, Helvetica, sans-serif" fontSize="26" fontWeight="400" letterSpacing="-1.2">Festio</text>}
  </svg>
}
