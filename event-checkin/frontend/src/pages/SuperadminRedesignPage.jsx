import RedesignShell from './redesign/RedesignShell'
import ConsolePage from './ConsolePage'

export default function SuperadminRedesignPage() {
  return <RedesignShell topActive="console" withEventSidebar={false}>
    <ConsolePage operations />
  </RedesignShell>
}
