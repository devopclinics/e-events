// Search the same instructions and context that every Help surface renders.
export function topicSearchText(topic) {
  return [topic.title, topic.intro, topic.path, topic.before, topic.check,
    topic.troubleshoot, topic.tip, topic.warn, ...(topic.steps || []),
    ...(topic.capabilities || []).flatMap(c => [c.title, c.body])]
    .filter(Boolean).join(' ').toLowerCase();
}
