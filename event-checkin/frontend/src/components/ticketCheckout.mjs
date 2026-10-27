export function ticketQuantity(raw, product) {
 const parsed=Number(raw);
 if(!Number.isFinite(parsed))return 0;
 return Math.max(0,Math.min(Math.floor(parsed),Number(product?.available??0),Number(product?.max_per_order??10)));
}
export function checkoutSummary(catalog, quantities, amounts={}) {
 const subtotal=(catalog.tickets||[]).filter(t=>t.product_type!=='external').reduce((sum,t)=>{
  const quantity=ticketQuantity(quantities[t.id]||0,t);
  const price=t.product_type==='donation'&&t.allow_custom_amount?Math.max(0,Math.round((Number(amounts[t.id])||0)*100)):t.price;
  return sum+price*quantity;
 },0);
 const fee=catalog.fee?.paid_by==='buyer'?Math.floor(subtotal*(catalog.fee.bps||0)/10000):0;
 const tax=catalog.tax?.enabled&&catalog.tax.paid_by==='buyer'?Math.floor(subtotal*(catalog.tax.bps||0)/10000):0;
 return {subtotal,fee,tax,total:subtotal+fee+tax};
}
