import ilorinPhoto from '../../assets/checkin/ilorin-central-mosque.jpg'
import './CheckinWelcome.css'

// Keep the convention identity scoped to its public event code.
export const hasIlorinWelcome = code => String(code).toLowerCase() === 'iedpu26'

export default function CheckinWelcome({ code, info, step = 1, children }) {
  if (!hasIlorinWelcome(code)) return <main className="ki-kiosk"><section className="ki-card vp-card">{children}</section></main>
  return <main className="ki-kiosk vp-heritage">
    <header className="vp-heritage-header">
      <div className="vp-heritage-brand"><img src="/iedpu-brand/logo.png" alt="IEDPU USA" width="54" height="54"/><div><strong>IEDPU USA</strong><span>3rd Biennial Convention</span></div></div>
      <span className="vp-heritage-edition">DALLAS ’26 <i aria-hidden="true">✦</i></span>
    </header>
    <div className="vp-heritage-layout">
      <aside className="vp-heritage-story" aria-label="Our Ilorin heritage">
        <img className="vp-heritage-photo" src={ilorinPhoto} alt="The golden domes and minarets of Ilorin Central Mosque" width="1280" height="960" decoding="async"/>
        <div className="vp-heritage-arch" aria-hidden="true"/>
        <div className="vp-heritage-story-copy"><p className="vp-heritage-eyebrow">FROM ILORIN, WITH LOVE</p><h2>Our roots.<br/>{' '}Our people.<br/><em>Together again.</em></h2><p>A little closer to home.<br/>A weekend to remember.</p></div>
        <div className="vp-heritage-values"><span>Unity</span><i aria-hidden="true">✦</i><span>Heritage</span><i aria-hidden="true">✦</i><span>Progress</span></div>
      </aside>
      <section className="ki-card vp-card vp-heritage-card">
        <ol className="vp-heritage-steps" aria-label="Check-in progress">{['Find registration', 'Your party', 'Check in'].map((label, index) => <li key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'complete' : ''} aria-current={step === index + 1 ? 'step' : undefined}><span aria-hidden="true">{step > index + 1 ? '✓' : `0${index + 1}`}</span><b>{label}</b></li>)}</ol>
        {children}
      </section>
    </div>
    <footer className="vp-heritage-footer"><p><strong>Ilorin at heart. Together in Dallas.</strong><span>Powered by <a href="https://festio.events">Festio</a></span></p><small>Ilorin Central Mosque · <a href="https://commons.wikimedia.org/wiki/File:Central_Mosque,_Ilorin.jpg" target="_blank" rel="noopener noreferrer">Photo: Timmylegend</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> · resized &amp; cropped</small></footer>
  </main>
}
