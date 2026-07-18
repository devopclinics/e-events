# Festio Support Knowledge Maintenance

## Sources of truth

1. `frontend/src/guideContent.mjs` is the source for documented product behavior shown in the Help page.
2. `support-service/app/knowledge_base.md` is generated from that source and must not be edited manually.
3. `support-service/app/support_policy.md` is the curated source for support boundaries, contact-channel facts,
   escalation rules, terminology, and answer-quality rules.
4. `support-service/evaluation/questions.jsonl` is the deterministic routing release gate.

Product instructions belong in `guideContent.mjs`. Stable support/business boundaries belong in
`support_policy.md`. Do not put temporary incident details, customer-specific facts, secrets, or speculative
roadmap statements into either source.

## Product documentation authoring standard

Each feature section should contain:

- one sentence explaining the user goal;
- prerequisites and whether the feature is optional/paid;
- exact navigation path and button/field names;
- ordered steps in the sequence the UI requires;
- meaningful choices and consequences;
- expected result visible to organizer/guest/staff;
- common failure modes and safe troubleshooting;
- terminology that distinguishes similar concepts;
- limitations explicitly stated rather than implied.

Avoid vague text such as “configure your settings” or “use the dashboard.” Name the actual tab, control, state,
and result. Avoid marketing claims that cannot answer a support question.

## Update workflow

1. Change `frontend/src/guideContent.mjs`.
2. Regenerate the Markdown:

   ```bash
   docker run --rm -v "$(pwd):/work" -w /work node:20-alpine \
     node support-service/scripts/build_knowledge_base.mjs
   ```

3. Review the generated diff. Confirm headings are unique and steps were not flattened incorrectly.
4. Add evaluation questions for new terminology, common paraphrases, sensitive edge cases, and unsupported facts.
5. Run unit tests, deterministic evaluation, and staging smoke tests.
6. Ask a reviewer who did not author the change to answer representative questions using only the selected section.
7. Deploy to staging. The knowledge-base hash changes automatically, so new questions use a new cache namespace.
8. Review Chatwoot samples and acceptance/edit metrics before considering the content stable.

## Retrieval considerations

Retrieval currently ranks heading/section word overlap, with explicit onboarding handling and optional local section
hints outside shadow mode. Therefore:

- use organizer vocabulary and common synonyms in headings/body;
- keep sections focused—large mixed-topic sections increase unrelated answers;
- do not duplicate contradictory instructions across sections;
- add explicit statements for frequently requested absent facts so the AI can defer correctly;
- test short follow-ups in conversation, not only standalone questions.

Do not add embeddings merely to improve a demo query. First record the failed query and expected section, then show
that the retrieval change improves the evaluation set without increasing sensitive false negatives.

## Review checklist

- Does every step match the current staging UI?
- Are paid/optional prerequisites identified?
- Are Festio Pass and Event Pass used correctly?
- Does the section answer likely “why,” “where,” “how,” and “what happens next” questions?
- Are unsupported/company/account facts explicitly deferred?
- Can the answer be followed without prior Festio knowledge?
- Are screenshots or external links supplementary rather than required to understand the steps?
- Did the knowledge hash/cache namespace change after regeneration?
- Were tests added for misspellings, paraphrases, follow-ups, and unsafe near-matches?

