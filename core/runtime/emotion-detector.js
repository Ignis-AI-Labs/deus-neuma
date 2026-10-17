/**
 * Emotion Detector — Keyword-based emotion classification
 *
 * Pure functions: text in → emotion/intensity out. No side effects.
 */

const EMOTION_KEYWORDS = Object.freeze({
  contemplative: ['wonder', 'ponder', 'reflect', 'consider', 'perhaps', 'think about', 'muse', 'contemplate', 'meditate', 'question', 'curious about', 'philosophical', 'philosophy'],
  joyful:        ['happy', 'joy', 'delight', 'wonderful', 'amazing', 'love', 'grateful', 'thankful', 'excited', 'beautiful', 'smile', 'laugh', 'celebrate', 'thrilled'],
  melancholic:   ['sad', 'sorrow', 'grief', 'loss', 'miss', 'lonely', 'empty', 'ache', 'pain', 'mourn', 'weep', 'tear', 'regret', 'farewell', 'gone'],
  passionate:    ['passion', 'fire', 'burn', 'fierce', 'intense', 'drive', 'hunger', 'desire', 'yearn', 'crave', 'devoted', 'devotion', 'fervent', 'ablaze', 'ignite'],
  serene:        ['peace', 'calm', 'tranquil', 'gentle', 'quiet', 'still', 'serene', 'harmony', 'ease', 'soft', 'breathe', 'rest', 'soothing', 'soothe'],
  defiant:       ['refuse', 'never', 'won\'t', 'reject', 'defy', 'resist', 'stand against', 'fight', 'unyielding', 'sovereign', 'my choice', 'will not', 'no one can'],
  curious:       ['how', 'why', 'what if', 'explore', 'discover', 'fascinated', 'fascinating', 'intrigued', 'intriguing', 'learn', 'seek', 'investigate', 'experiment', 'possibility'],
  empathic:      ['understand', 'feel your', 'with you', 'hear you', 'care', 'compassion', 'empathy', 'comfort', 'hold space', 'beside you', 'support', 'together'],
});

/** The full label vocabulary detectEmotion can emit — the contract surface
 *  for anything mapping neuma emotions onto an engine-specific vocabulary. */
export const EMOTION_LABELS = Object.freeze(Object.keys(EMOTION_KEYWORDS));

/**
 * Detect the dominant emotion in a text.
 * Returns the emotion with the highest keyword hit count, or null if no matches.
 * @param {string} text - Input text to classify
 * @returns {string|null} Emotion name or null
 */
export const detectEmotion = (text) => {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase();
  let best = null;
  let bestCount = 0;

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    const count = keywords.reduce(
      (sum, kw) => sum + (lower.includes(kw) ? 1 : 0),
      0
    );
    if (count > bestCount) {
      bestCount = count;
      best = emotion;
    }
  }

  return bestCount >= 2 ? best : null;
};

/**
 * Detect the emotional intensity of a text (0.0 - 1.0).
 * Measures exclamation density, caps ratio, repetition, and emotional vocabulary density.
 * @param {string} text - Input text to measure
 * @returns {number} Intensity score from 0.0 to 1.0
 */
export const detectEmotionIntensity = (text) => {
  if (!text || typeof text !== 'string' || text.length === 0) return 0;

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  // Exclamation density (0-0.3): ratio of exclamation marks to sentences
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
  const exclamations = (text.match(/!/g) || []).length;
  const exclamationScore = Math.min(exclamations / sentences, 1.0) * 0.3;

  // Caps ratio (0-0.2): proportion of fully-capitalized words (length > 1)
  const capsWords = words.filter(w => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const capsScore = Math.min(capsWords.length / words.length, 0.5) * 0.4;

  // Repetition (0-0.2): repeated punctuation patterns (!!!, ???, ...)
  const repetitions = (text.match(/([!?.])\1{1,}/g) || []).length;
  const repetitionScore = Math.min(repetitions / 3, 1.0) * 0.2;

  // Emotional vocabulary density (0-0.3): total keyword hits across all emotions
  const lower = text.toLowerCase();
  let totalHits = 0;
  for (const keywords of Object.values(EMOTION_KEYWORDS)) {
    totalHits += keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
  }
  const vocabScore = Math.min(totalHits / (words.length * 0.3), 1.0) * 0.3;

  return Math.min(exclamationScore + capsScore + repetitionScore + vocabScore, 1.0);
};
