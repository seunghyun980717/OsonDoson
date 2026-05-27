from __future__ import annotations

from collections import defaultdict

from app.container import RuntimeContainer


class GlossRecommendService:
    def __init__(self, container: RuntimeContainer) -> None:
        self.container = container

    def recommend(self, category: str, sequence: list[str], top_k: int = 8) -> list[str]:
        bigram_table, trigram_table, starter_table, w2v_model = self.container.get_gloss_recommend_resources()

        if not sequence:
            return starter_table.get(category, [])[:top_k]

        scores: defaultdict[str, float] = defaultdict(float)
        prev1 = sequence[-1]
        prev2 = sequence[-2] if len(sequence) >= 2 else None

        if prev2:
            key = f"{prev2}|{prev1}"
            trigram_result = trigram_table.get(category, {}).get(key, [])
            for index, gloss in enumerate(trigram_result):
                scores[gloss] += 0.7 * (top_k - index) / top_k

        bigram_result = bigram_table.get(category, {}).get(prev1, [])
        for index, gloss in enumerate(bigram_result):
            scores[gloss] += 0.5 * (top_k - index) / top_k

        if prev1 in w2v_model.wv:
            try:
                predicted = w2v_model.predict_output_word([prev1], topn=top_k * 2)
                if predicted:
                    for gloss, probability in predicted:
                        if gloss not in sequence:
                            scores[gloss] += 0.3 * probability
            except Exception:
                pass

        if not scores:
            return starter_table.get(category, [])[:top_k]

        return sorted(scores, key=lambda gloss: -scores[gloss])[:top_k]
