export const safeColor = (value, fallback) => /^#[a-f\d]{6}$/i.test(value || '') ? value : fallback;
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
export function contrastRatio(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function readableColor(background, preferred) {
  const color = safeColor(preferred, '#183e34');
  if (contrastRatio(color, background) >= 4.5) return color;
  return contrastRatio('#ffffff', background) > contrastRatio('#000000', background) ? '#ffffff' : '#000000';
}
export function welcomeColors(colors = {}) {
  const primary = safeColor(colors.primary, '#194e3e');
  const accent = safeColor(colors.accent, '#e9c968');
  const paper = safeColor(colors.background, '#f8f7f1');
  const surface = safeColor(colors.surface, '#ffffff');
  return {
    '--rw-primary': primary, '--rw-accent': accent, '--rw-paper': paper, '--rw-surface': surface,
    '--rw-ink': readableColor(surface, colors.text), '--rw-muted': readableColor(surface, colors.text),
    '--rw-primary-ink': readableColor(primary, colors.text), '--rw-accent-ink': readableColor(accent, colors.text),
    '--rw-hero-ink': readableColor('#ececcc', colors.text), '--rw-paper-ink': readableColor(paper, colors.text),
  };
}
