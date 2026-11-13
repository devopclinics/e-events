import { build } from 'esbuild'
import fs from 'node:fs'
const out = process.env.WORKFLOW_PREVIEW_DIR
fs.mkdirSync(out, { recursive: true })
const steps = Array.from({ length: 17 }, (_, i) => ({ id: `step-${i}`, step_type: 'custom_message', title: `Teaching scene ${i + 1}`, config: { lines: ['Review your situation', 'Confirm eligibility', 'Give responsibly'] } }))
steps[0] = { ...steps[0], step_type: 'hero', title: 'ZAKAT', subtitle: 'When wealth becomes well-being' }
steps[8] = { ...steps[8], step_type: 'poll', title: 'Assuming all conditions are met, what is 2.5% of $10,000 eligible wealth?', config: { options: ['$25', '$250', '$2,500'] } }
steps[16] = { ...steps[16], step_type: 'closing', title: 'REVIEW. CONFIRM. ACT.', subtitle: 'Faith into action, with knowledge and care.' }
const workflow = { id: 'fixture', name: 'Zakat — Faith into action', status: 'ready', theme: { preset: 'legacy_cinematic' }, steps }
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Panel from './src/components/live/ExperienceWorkflowsPanel';createRoot(document.getElementById('root')).render(<Panel eventId="fixture-only"/>);`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: out + '/app.js', bundle: true, jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'api', setup(b) { b.onResolve({ filter: /^\.\.\/\.\.\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const workflow=${JSON.stringify(workflow)};export const api={liveWorkflows:async()=>[workflow],liveWorkflow:async()=>workflow,liveActiveWorkflowRun:async()=>({run:null})};`, loader: 'js' })) } }] })
fs.writeFileSync(out + '/index.html', '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial}#root{width:min(860px,100%);margin:auto}*{box-sizing:border-box}</style><div id="root"></div><script src="/app.js"></script>')
