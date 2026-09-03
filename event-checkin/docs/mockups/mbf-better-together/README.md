# MBF Summit 2026 — The Good Life · Better Together

Design-only mockup for a reusable Festio Live Experience workflow. This is not a staging screenshot and no workflow has been imported.

## Source lock

This restructures the previously approved "The Good Life — Men and Young Men" concept (`docs/mockups/good-life-men/`) into a single cinematic opening experience — same source material (`Harvad 75yrs- goof life for men.pdf`, Harvard Study of Adult Development), same core questions, reframed as one narrative arc (Acts 1–7) rather than a sequence of standalone polls. The mockup does not add new subject matter, scripture, research, or commitments beyond what the organizer specified.

## What's already real vs. what needs building

Every result style pictured except two scenes already exists in `frontend/src/components/live/WorkflowSceneRenderer.jsx` and is exercised today by the live `mbf_good_life.json` workflow: `hero`, `custom_message`, `poll`, `poll_results` (with `bars` / `donut` / `connection_gauge` / `legacy_podium` / `diagram` result styles), `game`, `video`, `word_cloud`, `comparison`, `closing`. Word-cloud case/duplicate normalization is already implemented in `app/wordcloud.py`.

Two scenes need engineering work before this can ship as drafted:

1. **Scene 14 — "How Connected Are We?" triple stat.** `big_number` is declared in `workflow_schemas.py`'s `StepType` but has no case in `WorkflowSceneRenderer.jsx` — it renders blank today. Needs a renderer.
2. **Scene 05/15 — Community Connection Map, 6 relationship categories.** The `diagram` result style's CSS grid (`WorkflowRuntimePolish.css`) only has 5 satellite slots (top/left/middle/right/bottom). Either trim to 5 categories or extend the grid to a full 3×3 (adds 3 corner slots) — a small, scoped change since the renderer is already in production.

## Review artifact

- `experience-mockup.html` — editable scene board, source of the design review.

After approval: build the two flagged renderer gaps, assemble the sequence as a workflow-definition JSON (same pattern `engagement-service/fixtures/mbf_good_life.json` already uses), import to staging via `scripts/import_workflow_definition.py`, and review live before any production promotion.
