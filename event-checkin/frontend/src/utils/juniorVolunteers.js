export function parseVolunteers(text){
 return text.trim().split(/\r?\n/).filter(x=>x.trim()).map((line,i)=>{const cells=line.split(line.includes('\t')?'\t':',').map(x=>x.trim());if(cells.length<2||cells.length>3)throw new Error(`Row ${i+1}: use Name, Email, Phone (optional).`);return {name:cells[0],email:cells[1],phone:cells[2]||null}})
}
