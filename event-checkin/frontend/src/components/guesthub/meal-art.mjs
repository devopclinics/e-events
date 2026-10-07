// Artwork is decorative and chosen only from published names, never dietary assumptions.
const kinds = [
  ['bread', /\b(meat pie|fish roll|puff puff)\b/i],
  ['pizza', /\bpizza\b/i],
  ['white-rice', /\bwhite rice\b/i],
  ['rice', /\b(rice|jollof|biryani|pilau)\b/i],
  ['salad', /\b(salad|vegetables|veggies)\b/i],
  ['amala', /\bamala\b/i],
  ['swallow', /\b(amala|iyan|eba|fufu|pounded yam)\b/i],
  ['soup', /\b(soup|ewedu|efo|efo-riro|ayamashe|ayamase)\b/i],
  ['chicken', /\b(chicken|wings|drumsticks|turkey)\b/i],
  ['fish', /\b(fish|salmon|tilapia)\b/i],
  ['pasta', /\b(pasta|spaghetti|noodles|macaroni)\b/i],
  ['plantain', /\b(dodo|plantain)\b/i],
  ['beans', /\bbeans?\b/i],
  ['yam', /\b(asaro|yam|porridge)\b/i],
  ['bread', /\b(bread|bun|buns|toast|roll|rolls|meat pie|pastry|puff puff)\b/i],
  ['meat', /\b(meat|beef|lamb|goat)\b/i],
  ['fries', /\b(fries|chips)\b/i],
  ['drink', /\b(drink|juice|caprisone|capri sun|water|tea|coffee)\b/i],
  ['stew', /\b(stew|sauce|ata dindin)\b/i],
  ['breakfast', /\b(egg|eggs|oats|oatmeal|pancake|pancakes)\b/i],
  ['fruit', /\b(fruit|apple|orange|melon|banana)\b/i],
];
export function mealArtKinds(option = {}) {
  const names = option.items?.length ? option.items.map(item => item.name || '') : [option.name || ''];
  const matches = names.flatMap(name => name.split(/\s*\+\s*|\s+and\s+|\s+with\s+/i).map(part => kinds.find(([, pattern]) => pattern.test(part))?.[0]).filter(Boolean));
  const unique = [...new Set(matches)].slice(0, 4);
  return unique.length ? unique : ['serving'];
}
export function mealArtTone(seed = '') {
  return Array.from(String(seed)).reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0) % 5;
}
