export const APP_THEMES = [
  { id: 'event', name: 'Event colours', description: 'Your organizer’s brand colours.' },
  { id: 'light', name: 'Light', description: 'Fresh white surfaces and calm green accents.' },
  { id: 'dark', name: 'Dark', description: 'Charcoal surfaces with soft mint accents.' },
  { id: 'gold', name: 'Gold', description: 'Warm ivory, rich gold and deep brown.' },
  { id: 'ocean', name: 'Ocean', description: 'Cool blue with crisp, airy surfaces.' },
];
export const validAppTheme = value => APP_THEMES.some(theme => theme.id === value) ? value : 'event';
export const appearanceKey = eventId => `festio:guesthub:appearance:${eventId}`;
export function storedAppearance(eventId, preview = false) {
  if (preview) return 'default';
  try { const value = localStorage.getItem(appearanceKey(eventId)); return APP_THEMES.some(t => t.id === value && value !== 'event') ? value : 'default'; } catch { return 'default'; }
}
export function contrastText(hex) {
  const c = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255);
  const l = c.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126,.7152,.0722][i],0);
  return l > .18 ? '#142d25' : '#ffffff';
}
export function appearanceTokens(id, colors = {}) {
  const tokens = {
    '--green':'#124b3c','--deep':'#10372e','--mint':'#e5f3ec','--gold':'#d6b45e','--ink':'#18372f','--muted':'#60736b','--line':'#dce6df','--bg':'#f4f6f2','--white':'#ffffff','--canvas':'#e9eeea',
    '--warm-bg':'#faf0d6','--warm-ink':'#755714','--blue-bg':'#e8eff9','--blue-ink':'#365b88','--lilac-bg':'#eeeafa','--lilac-ink':'#65538b','--error-bg':'#fff0ed','--error-ink':'#9c2525',
    '--on-sidebar':'#f4faf5','--sidebar-muted':'#c0d7cb','--hero-muted':'#d3e4d9','--scheme':'light',
  };
  if (id === 'dark') Object.assign(tokens, {'--green':'#9bdabd','--deep':'#10241e','--mint':'#263e33','--gold':'#e0bd6e','--ink':'#ecf2ee','--muted':'#b4c3ba','--line':'#3c4d43','--bg':'#17221c','--white':'#202e26','--canvas':'#0e1712','--warm-bg':'#3d3321','--warm-ink':'#f2d392','--blue-bg':'#253548','--blue-ink':'#b4d6fb','--lilac-bg':'#373044','--lilac-ink':'#d1bfed','--error-bg':'#462d29','--error-ink':'#ffb8a8','--scheme':'dark'});
  if (id === 'gold') Object.assign(tokens, {'--green':'#71501c','--deep':'#322817','--mint':'#f2e7ca','--gold':'#dfbc67','--ink':'#352b1a','--muted':'#756343','--line':'#e2d5b8','--bg':'#faf5e9','--white':'#fffdf6','--canvas':'#eee5d1','--warm-bg':'#f5e7bd','--warm-ink':'#705014','--sidebar-muted':'#ddd0b5','--hero-muted':'#efe4cc'});
  if (id === 'ocean') Object.assign(tokens, {'--green':'#235c87','--deep':'#15374f','--mint':'#e1eff8','--gold':'#e1c17b','--ink':'#18354c','--muted':'#546e82','--line':'#d0e0eb','--bg':'#f0f6fa','--white':'#ffffff','--canvas':'#e1edf5','--sidebar-muted':'#bfd6e6','--hero-muted':'#d1e4f2'});
  if (id === 'event') {
    const hex = value => /^#[0-9a-f]{6}$/i.test(value || '');
    if (hex(colors.primary)) tokens['--green'] = tokens['--deep'] = colors.primary;
    if (hex(colors.accent)) tokens['--gold'] = colors.accent;
    if (hex(colors.background)) tokens['--bg'] = tokens['--canvas'] = colors.background;
    if (hex(colors.surface)) tokens['--white'] = colors.surface;
    if (hex(colors.text)) tokens['--ink'] = colors.text;
    tokens['--on-sidebar'] = tokens['--sidebar-muted'] = contrastText(tokens['--deep']);
  }
  tokens['--on-primary'] = contrastText(tokens['--green']);
  tokens['--hero-bg'] = id === 'dark' ? '#234535' : tokens['--green'];
  tokens['--on-hero'] = contrastText(tokens['--hero-bg']);
  if (tokens['--on-hero'] !== '#ffffff') tokens['--hero-muted'] = tokens['--on-hero'];
  return tokens;
}
