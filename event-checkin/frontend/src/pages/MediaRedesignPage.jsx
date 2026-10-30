import RedesignShell from './redesign/RedesignShell'
import MediaLibrary from '../components/media-library/MediaLibrary'

export default function MediaRedesignPage() {
  return (
    <RedesignShell topActive="media" withEventSidebar={false}>
      <MediaLibrary />
    </RedesignShell>
  )
}
