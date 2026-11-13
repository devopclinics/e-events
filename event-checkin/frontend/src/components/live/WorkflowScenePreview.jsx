import { useLayoutEffect, useRef, useState } from 'react'
import WorkflowSceneRenderer from './WorkflowSceneRenderer'

// Keep slide composition independent of the surrounding editor columns.
// Only the canvas scales; scene selection never changes the frame dimensions.
export default function WorkflowScenePreview({ step, eventId }) {
  const frame = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = frame.current
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <div className="wf-preview-frame" ref={frame} aria-label="Slide preview">
    <div className="wf-preview-canvas" style={{ transform: `scale(${width / 1280})`, visibility: width ? 'visible' : 'hidden' }}>
      <WorkflowSceneRenderer key={step?.id} step={step} mode="presenter" eventId={eventId}/>
    </div>
  </div>
}
