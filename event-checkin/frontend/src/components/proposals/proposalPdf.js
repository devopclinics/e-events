// Export the same reviewed page DOM that is shown in the studio; no server-side URL fetching.
export async function createProposalPdf(frame) {
 const doc=frame?.contentDocument
 if(!doc)throw new Error('Wait for the proposal preview to load.')
 const pages=[...doc.querySelectorAll('.sheet')]
 if(pages.length!==3)throw new Error('The proposal must contain three complete pages.')
 await doc.fonts?.ready
 const originals=[]
 try {
  for(const image of doc.images){
   if(!image.complete||!image.naturalWidth)throw new Error('An image is not ready. Choose another image or upload a copy.')
   if(image.src.startsWith('data:'))continue
   const response=await fetch(image.src,{mode:'cors',credentials:new URL(image.src).origin===location.origin?'same-origin':'omit'})
   if(!response.ok)throw new Error('Could not embed an image in the PDF. Upload a local copy or choose another image.')
   const blob=await response.blob();const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})
   originals.push([image,image.src]);image.src=data;await image.decode()
  }
  const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas'),import('jspdf')])
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});pdf.setProperties({title:'Festio Event Proposal',creator:'Festio Proposal Studio'})
  for(let i=0;i<pages.length;i++){
   const p=pages[i]
   if(p.scrollHeight>p.clientHeight+1||p.querySelector('footer').getBoundingClientRect().top<p.querySelector('footer').previousElementSibling.getBoundingClientRect().bottom+8)throw new Error('A page overflows. Shorten the proposal before exporting.')
   const canvas=await html2canvas(p,{scale:2,backgroundColor:'#fcfaf5',useCORS:true,logging:false,windowWidth:820,windowHeight:1200,scrollX:0,scrollY:0})
   if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',0,0,210,297)
  }
  const blob=pdf.output('blob');if(blob.size>5*1024*1024)throw new Error('The PDF exceeds 5 MB. Use smaller images before exporting.')
  return blob
 } finally {for(const [img,url] of originals)img.src=url}
}
