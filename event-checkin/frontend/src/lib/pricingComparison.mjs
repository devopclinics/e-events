export function pricingComparison(data,promoActive){
 const paid=data?.tiers||[],count=paid.length,repeat=value=>Array(count).fill(value)
 return [
 ['Guest limit',String(data?.free?.guest_cap||25),...paid.map(t=>String(t.guest_cap||'See plan')),'Custom'],
 ['Email invitations','Yes',...repeat('Yes'),'Custom'],
 ['QR check-in','Yes',...repeat('Yes'),'Yes'],
 ['Design Studio','No',...repeat('Included'),'Custom'],
 ['Seating/table groups','No',...repeat(promoActive?'Included during promotion':'Optional add-on'),'Custom'],
 ['Access zones/gates','No',...repeat(promoActive?'Included during promotion':'Optional add-on'),'Custom'],
 ['Experience workflows','No',...repeat(promoActive?'Included during promotion':'Optional add-on'),'Custom'],
 ['Consent/scanner confirmations','No',...repeat(promoActive?'Included during promotion':'Optional add-on'),'Custom'],
 ['SMS/WhatsApp','No',...repeat('Sending access · credits apply'),'Custom'],
 ]
}

