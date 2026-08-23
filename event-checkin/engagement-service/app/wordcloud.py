import re
from collections import Counter

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "of", "in", "on",
    "for", "with", "this", "that", "it", "its", "i", "we", "you", "my", "our", "your", "as",
    "at", "be", "by", "have", "has", "had", "not", "so", "if", "just", "very", "really", "im",
    "its", "than", "then", "there", "their", "they", "them", "will", "would", "could", "should",
}


def word_cloud(texts: list[str], limit: int = 40) -> list[dict]:
    counts: Counter[str] = Counter()
    for text in texts:
        for word in re.findall(r"[a-zA-Z']+", (text or "").lower()):
            word = word.strip("'")
            if len(word) < 3 or word in _STOPWORDS:
                continue
            counts[word] += 1
    return [{"word": w, "count": c} for w, c in counts.most_common(limit)]
