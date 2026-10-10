/**
 * Precision and recall of predicted topic tags against hand labels.
 * A tag is the pair (topic, polarity); evidence and severity are ignored.
 */

const key = (t) => `${t.topic}:${t.polarity}`;

/**
 * @param {Array<{ id: string; expected: Array<{topic: string; polarity: string}>; predicted: Array<{topic: string; polarity: string}> }>} cases
 */
export function scoreTags(cases) {
  const per = new Map();
  const bump = (k, field) => {
    if (!per.has(k)) per.set(k, { tp: 0, fp: 0, fn: 0 });
    per.get(k)[field] += 1;
  };
  const failures = [];
  for (const c of cases) {
    const expected = new Set(c.expected.map(key));
    const predicted = new Set(c.predicted.map(key));
    const missed = [...expected].filter((k) => !predicted.has(k));
    const extra = [...predicted].filter((k) => !expected.has(k));
    for (const k of predicted) bump(k, expected.has(k) ? "tp" : "fp");
    for (const k of missed) bump(k, "fn");
    if (missed.length || extra.length) failures.push({ id: c.id, missed, extra });
  }
  const ratio = (a, b) => (b ? a / b : null);
  const rows = [...per.entries()]
    .map(([k, v]) => ({ tag: k, ...v, precision: ratio(v.tp, v.tp + v.fp), recall: ratio(v.tp, v.tp + v.fn) }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  const total = rows.reduce((s, r) => ({ tp: s.tp + r.tp, fp: s.fp + r.fp, fn: s.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  return {
    rows,
    overall: { ...total, precision: ratio(total.tp, total.tp + total.fp), recall: ratio(total.tp, total.tp + total.fn) },
    failures,
  };
}
