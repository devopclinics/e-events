import RedesignShell from './redesign/RedesignShell'
import InvoiceLibrary from '../components/media-library/InvoiceLibrary'
export default function InvoicesPage() {
  return <RedesignShell topActive="org" withEventSidebar={false}><InvoiceLibrary /></RedesignShell>
}
