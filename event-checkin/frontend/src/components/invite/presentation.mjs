import { readableColor } from './themeContrast.mjs';
export const SECTION_LABELS = {overview:'About & GuestHub',highlights:'Highlights',programme:'Programme',travel:'Plan your visit',faq:'Helpful details'};
export const SECTION_ORDER = Object.keys(SECTION_LABELS);
const choose = (value, values, fallback) => values.includes(value) ? value : fallback;
export function presentation(config = {}) {
 const raw = config && typeof config === 'object' ? config : {};
 const order = Array.isArray(raw.sectionOrder) ? [...new Set(raw.sectionOrder.filter(id => SECTION_ORDER.includes(id)))] : [];
 const sectionColors = Object.fromEntries(Object.entries(raw.sectionColors || {}).filter(([key,value]) => ['hero',...SECTION_ORDER].includes(key) && typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)));
 return {spacing:choose(raw.spacing,['compact','comfortable','airy'],'comfortable'),cards:choose(raw.cards,['grid','list'],'grid'),shape:choose(raw.shape,['theme','square','rounded','circle','hexagon'],'theme'),imagePlacement:choose(raw.imagePlacement,['theme','left','right','top'],'theme'),sectionOrder:[...order,...SECTION_ORDER.filter(id=>!order.includes(id))],sectionColors};
}
export function sectionStyle(config, id) {
 const background = config.sectionColors[id];
 return background ? {background, color:readableColor(background), '--rw-section-ink':readableColor(background)} : {};
}
