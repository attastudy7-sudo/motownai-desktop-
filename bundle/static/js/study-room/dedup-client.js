/* Shared client-side dedup key helper for study-room resource tabs.

 * Mirrors app/services/dedup_service.py::normalize_key so the server and the
 * client derive identical keys for the same item. Kept dependency-free so it
 * can be loaded before the tab engines and exercised by the node harness in
 * tests/test_dedup_key_parity.py.
 *
 * Key priority per type (must stay in lockstep with Python):
 *   - flashcards:       front + back combined
 *   - fill_in:          text_segments joined (fallback: sentence)
 *   - quiz/micro_quiz:  question_text (fallback: question, then text)
 */
(function (global) {
  function normalizeText(value) {
    if (typeof value !== 'string') return '';
    var text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return text.trim().toLowerCase();
  }

  function dedupKey(item, itemType) {
    if (!item || typeof item !== 'object') return '';
    if (itemType === 'flashcards') {
      var front = normalizeText(item.front);
      var back = normalizeText(item.back);
      if (!front && !back) return '';
      return front + '\u001f' + back;
    }
    if (itemType === 'fill_in') {
      if (Array.isArray(item.text_segments) && item.text_segments.length) {
        var joined = item.text_segments
          .map(normalizeText)
          .filter(function (s) { return s; })
          .join('\u001f');
        if (joined) return joined;
      }
      return normalizeText(item.sentence);
    }
    var keys = ['question_text', 'question', 'text'];
    for (var i = 0; i < keys.length; i++) {
      var value = item[keys[i]];
      if (typeof value === 'string' && value.trim()) {
        return normalizeText(value);
      }
    }
    return '';
  }

  function dedupItems(items, itemType) {
    if (!Array.isArray(items)) return items;
    var seen = {};
    var out = [];
    items.forEach(function (item) {
      var key = dedupKey(item, itemType);
      if (key) {
        if (seen[key]) return;
        seen[key] = true;
      }
      out.push(item);
    });
    return out;
  }

  global._dedupKey = dedupKey;
  global._dedupItems = dedupItems;
})(window);
