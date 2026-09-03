"""Import a declarative workflow into one staging event.

Usage (inside engagement-service container):
  python scripts/import_workflow_definition.py fixtures/mbf_good_life.json \
    --org-id ORG --event-id EVENT --actor-id USER

The importer is generic. MBF is data, not application code. It refuses to
overwrite a same-named workflow so an accidental rerun cannot alter rehearsal
or historical state.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.models import (
    ActivityQuestion, EngagementActivity, ExperienceWorkflow, QuestionOption,
    WorkflowRevision, WorkflowStep,
)


async def import_definition(path: Path, org_id: str, event_id: str, actor_id: str) -> str:
    definition = json.loads(path.read_text())
    async with SessionLocal() as db:
        existing = await db.scalar(select(ExperienceWorkflow).where(
            ExperienceWorkflow.org_id == org_id,
            ExperienceWorkflow.event_id == event_id,
            ExperienceWorkflow.name == definition["name"],
        ))
        if existing:
            raise RuntimeError(f"Workflow already exists: {existing.id}")

        title_by_key = {}
        for step in definition["steps"]:
            if step.get("activity_key") and step["step_type"] not in ("poll_results",):
                title_by_key.setdefault(step["activity_key"], step["title"])

        bindings = {}
        for key, source in definition.get("activities", {}).items():
            copied = definition["activities"].get(source.get("copy_question_from"), {})
            activity_spec = {**copied, **source}
            activity = EngagementActivity(
                org_id=org_id, event_id=event_id, type=activity_spec["type"],
                title=title_by_key.get(key, key.replace("_", " ").title()), status="draft",
                config={
                    "anonymous": bool(activity_spec.get("anonymous")),
                    "moderation_enabled": bool(activity_spec.get("moderation_enabled")),
                    "live_results_enabled": True,
                }, created_by=actor_id,
            )
            db.add(activity); await db.flush()
            question = ActivityQuestion(
                activity_id=activity.id, question_type=activity_spec["question_type"],
                prompt=activity.title, sequence=0, required=True,
                config={"max_selections": activity_spec.get("max_selections")},
            )
            db.add(question); await db.flush()
            for sequence, label in enumerate(activity_spec.get("options", [])):
                db.add(QuestionOption(question_id=question.id, label=label, sequence=sequence))
            bindings[key] = (activity.id, question.id)

        workflow = ExperienceWorkflow(
            org_id=org_id, event_id=event_id, name=definition["name"],
            description=definition.get("description"), theme=definition.get("theme", {}),
            status="draft", created_by=actor_id,
        )
        db.add(workflow); await db.flush()
        draft_steps = []
        for sequence, source in enumerate(definition["steps"]):
            activity_id = question_id = None
            if source.get("activity_key"):
                activity_id, question_id = bindings[source["activity_key"]]
            config = dict(source.get("config") or {})
            presenter = source.get("presenter") or {}
            if presenter:
                config["presenter"] = presenter
            if source.get("comparison_keys"):
                first, second = source["comparison_keys"]
                config.update(question_a_id=bindings[first][1], question_b_id=bindings[second][1])
            if source.get("metric_sources"):
                config["metrics"] = [
                    {
                        "question_id": bindings[metric["activity_key"]][1],
                        "option_labels": metric["option_labels"],
                        "label": metric["label"],
                    }
                    for metric in source["metric_sources"]
                ]
            # The presenter console only surfaces `presenter_notes` (a single
            # string), so fold the richer authoring fields (talking point,
            # stage direction, what comes next) into one note here rather
            # than losing action_cue/transition on the studio floor.
            notes_parts = []
            if presenter.get("talking_point"):
                notes_parts.append(presenter["talking_point"])
            if presenter.get("action_cue"):
                cue = presenter["action_cue"]
                if presenter.get("target_duration"):
                    cue = f"{cue}  (~{presenter['target_duration']})"
                notes_parts.append(f"Cue: {cue}")
            if presenter.get("transition"):
                notes_parts.append(f"Next: {presenter['transition']}")
            computed_notes = "\n\n".join(notes_parts) if notes_parts else None
            step = WorkflowStep(
                workflow_id=workflow.id, sequence=sequence, step_type=source["step_type"],
                title=source["title"], subtitle=source.get("subtitle"), config=config,
                linked_activity_id=activity_id, linked_question_id=question_id,
                duration_seconds=source.get("duration_seconds"),
                auto_advance=bool(source.get("auto_advance")),
                presenter_notes=source.get("presenter_notes") or computed_notes, status="active",
            )
            db.add(step); draft_steps.append(step)
        await db.flush()

        revision = WorkflowRevision(
            workflow_id=workflow.id, revision_number=1, name=workflow.name,
            description=workflow.description, theme=workflow.theme,
            published_by=actor_id,
        )
        db.add(revision); await db.flush()
        for draft in draft_steps:
            db.add(WorkflowStep(
                workflow_id=workflow.id, revision_id=revision.id, sequence=draft.sequence,
                step_type=draft.step_type, title=draft.title, subtitle=draft.subtitle,
                config=draft.config, linked_activity_id=draft.linked_activity_id,
                linked_question_id=draft.linked_question_id,
                duration_seconds=draft.duration_seconds, auto_advance=draft.auto_advance,
                presenter_notes=draft.presenter_notes, status="active",
            ))
        workflow.current_revision_id = revision.id
        workflow.status = "ready"
        await db.commit()
        return workflow.id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("definition", type=Path)
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--actor-id", required=True)
    args = parser.parse_args()
    workflow_id = asyncio.run(import_definition(args.definition, args.org_id, args.event_id, args.actor_id))
    print(json.dumps({"workflow_id": workflow_id, "status": "ready"}))


if __name__ == "__main__":
    main()
