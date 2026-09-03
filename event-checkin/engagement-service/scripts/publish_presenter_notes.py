"""Publish structured presenter guidance onto an existing workflow.

The script creates a new immutable revision; active and historical runs keep
their original revision. The definition must have the same ordered step shape.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import ExperienceWorkflow, WorkflowRevision, WorkflowStep


async def publish(path: Path, event_id: str, actor_id: str) -> tuple[str, int]:
    definition = json.loads(path.read_text())
    async with SessionLocal() as db:
        workflow = await db.scalar(select(ExperienceWorkflow).where(
            ExperienceWorkflow.event_id == event_id,
            ExperienceWorkflow.name == definition["name"],
        ))
        if not workflow:
            raise RuntimeError("Workflow not found")
        drafts = list((await db.execute(select(WorkflowStep).where(
            WorkflowStep.workflow_id == workflow.id,
            WorkflowStep.revision_id.is_(None),
        ).order_by(WorkflowStep.sequence))).scalars())
        sources = definition["steps"]
        if len(drafts) != len(sources):
            raise RuntimeError(f"Step count mismatch: workflow={len(drafts)} definition={len(sources)}")
        for draft, source in zip(drafts, sources):
            if draft.step_type != source["step_type"]:
                raise RuntimeError(f"Step {draft.sequence + 1} type mismatch")
            presenter = source.get("presenter") or {}
            source_config = source.get("config") or {}
            media_config = {
                key: source_config[key]
                for key in ("video_url", "poster_url", "captions_url", "requires_presenter_play")
                if key in source_config
            }
            draft.config = {**(draft.config or {}), **media_config, "presenter": presenter}
            draft.presenter_notes = presenter.get("talking_point")

        next_number = 1 + (await db.scalar(select(func.max(WorkflowRevision.revision_number)).where(
            WorkflowRevision.workflow_id == workflow.id,
        )) or 0)
        revision = WorkflowRevision(
            workflow_id=workflow.id, revision_number=next_number,
            name=workflow.name, description=workflow.description,
            theme={**(workflow.theme or {}), "guest_preset": (workflow.theme or {}).get("guest_preset", "cinematic")},
            published_by=actor_id,
        )
        db.add(revision); await db.flush()
        for draft in drafts:
            db.add(WorkflowStep(
                workflow_id=workflow.id, revision_id=revision.id, sequence=draft.sequence,
                step_type=draft.step_type, title=draft.title, subtitle=draft.subtitle,
                config=draft.config, linked_activity_id=draft.linked_activity_id,
                linked_question_id=draft.linked_question_id,
                duration_seconds=draft.duration_seconds, auto_advance=draft.auto_advance,
                presenter_notes=draft.presenter_notes, status=draft.status,
            ))
        workflow.theme = revision.theme
        workflow.current_revision_id = revision.id
        workflow.draft_version += 1
        workflow.status = "ready"
        await db.commit()
        return workflow.id, next_number


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("definition", type=Path)
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--actor-id", required=True)
    args = parser.parse_args()
    workflow_id, revision = asyncio.run(publish(args.definition, args.event_id, args.actor_id))
    print(json.dumps({"workflow_id": workflow_id, "revision": revision, "status": "ready"}))


if __name__ == "__main__":
    main()
