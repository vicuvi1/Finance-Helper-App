// Callout labels for the "Where your money goes" donut. Pure (no page).
// Each label sits left or right of the ring at the height of its slice, then
// is pushed up or down so two labels on one side are never closer than `gap`
// (several small neighbouring slices would otherwise print on top of each other).

// anchors: [{ y }] wanted heights, any order. Returns the heights in the same order.
export function spreadLabels(anchors, { gap = 17, top = 12, bottom = 288 } = {}) {
  const order = anchors.map((a, i) => ({ i, y: a.y })).sort((a, b) => a.y - b.y);
  for (let k = 0; k < order.length; k++) {
    order[k].y = Math.max(order[k].y, top);
    if (k && order[k].y < order[k - 1].y + gap) order[k].y = order[k - 1].y + gap;
  }
  for (let k = order.length - 1; k >= 0; k--) {
    if (order[k].y > bottom) order[k].y = bottom;
    if (k < order.length - 1 && order[k].y > order[k + 1].y - gap) order[k].y = order[k + 1].y - gap;
  }
  const out = [];
  for (const o of order) out[o.i] = o.y;
  return out;
}
