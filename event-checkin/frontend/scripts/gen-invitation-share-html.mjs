import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
let html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8')
const title='Create beautiful invitations for free | Festio'
const description='Birthdays, weddings, naming ceremonies and more. Pick a design, share your link and collect RSVPs. Guests reply without an account.'
const image='https://festio.events/media/invitation-share-card-2026.png'
html=html.replace(/<title>[^<]*<\/title>/,`<title>${title}</title>`)
for(const [kind,name,value] of [['name','description',description],['property','og:title',title],['property','og:description',description],['property','og:url','https://festio.events/create-invitation'],['property','og:image',image],['name','twitter:title',title],['name','twitter:description',description],['name','twitter:image',image]]){
 const pattern=new RegExp(`<meta ${kind}="${name}" content="[^"]*" />`)
 if(!pattern.test(html))throw Error(`Missing ${name} in application entry`)
 html=html.replace(pattern,`<meta ${kind}="${name}" content="${value}" />`)
}
html=html.replace('</head>','<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="Festio invitation designs for a birthday and dinner with friends" /><link rel="canonical" href="https://festio.events/create-invitation" /></head>')
fs.writeFileSync(path.join(root,'dist/create-invitation.html'),html)
console.log('Wrote dist/create-invitation.html with invitation-specific social metadata')
