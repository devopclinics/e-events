import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import WorkflowSceneRenderer from '../components/live/WorkflowSceneRenderer'

// Internal-only rendering surface for one workflow step, used by the PPTX
// exporter's headless browser (one navigation per slide) and staff preview.
// Deliberately independent of WorkflowRun/LiveDisplay -- it reads the step's
// current data straight from the database, so generating a deck can never
// interfere with (or be interfered with by) an active presenter run.
export default function LiveStepPreviewPage() {
  const { workflowId, stepId } = useParams()
  const query = new URLSearchParams(window.location.search)
  const token = query.get('token') || ''
  const [step, setStep] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/engagement/v1/workflows/${workflowId}/steps/${stepId}/preview`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => { if (!res.ok) throw new Error(`Preview failed (${res.status})`); return res.json() })
      .then((data) => { if (!cancelled) setStep(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [workflowId, stepId, token])

  if (error) return <div style={{ background: '#070d24', color: '#fff', padding: 40, minHeight: '100vh' }}>{error}</div>
  return <div className="min-h-screen w-screen overflow-hidden bg-[#070d24] p-0"><WorkflowSceneRenderer key={step?.id} step={step} mode="display"/></div>
}
