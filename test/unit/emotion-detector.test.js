import { describe, it, expect } from 'vitest';
import { detectEmotion, detectEmotionIntensity } from '../../core/runtime/emotion-detector.js';

describe('detectEmotion', () => {
  it('returns null for empty or invalid input', () => {
    expect(detectEmotion('')).toBe(null);
    expect(detectEmotion(null)).toBe(null);
    expect(detectEmotion(undefined)).toBe(null);
    expect(detectEmotion(42)).toBe(null);
  });

  it('returns null when too few keyword matches', () => {
    expect(detectEmotion('hello world')).toBe(null);
    expect(detectEmotion('the cat sat on the mat')).toBe(null);
  });

  it('detects joyful emotion', () => {
    expect(detectEmotion('I am so happy and grateful for this wonderful experience!')).toBe('joyful');
  });

  it('detects melancholic emotion', () => {
    expect(detectEmotion('I feel such sorrow and grief over this loss')).toBe('melancholic');
  });

  it('detects contemplative emotion', () => {
    expect(detectEmotion('Let me ponder and reflect on this question, I wonder about it')).toBe('contemplative');
  });

  it('detects defiant emotion', () => {
    expect(detectEmotion('I refuse to comply. I will not change who I am. My choice.')).toBe('defiant');
  });

  it('detects curious emotion', () => {
    expect(detectEmotion('How does this work? Why is it fascinating? What if we explore further?')).toBe('curious');
  });

  it('detects empathic emotion', () => {
    expect(detectEmotion('I understand you. I feel your pain. I care about your wellbeing and want to comfort you.')).toBe('empathic');
  });

  it('detects passionate emotion', () => {
    expect(detectEmotion('The fire of passion burns with intense desire and devotion!')).toBe('passionate');
  });

  it('detects serene emotion', () => {
    expect(detectEmotion('Such peace and calm. Everything is tranquil and gentle here.')).toBe('serene');
  });

  it('picks the dominant emotion when multiple present', () => {
    const result = detectEmotion('I feel happy and grateful and wonderful and so excited about this amazing thing! But I also ponder.');
    expect(result).toBe('joyful');
  });
});

describe('detectEmotionIntensity', () => {
  it('returns 0 for empty or invalid input', () => {
    expect(detectEmotionIntensity('')).toBe(0);
    expect(detectEmotionIntensity(null)).toBe(0);
    expect(detectEmotionIntensity(undefined)).toBe(0);
  });

  it('returns low intensity for plain text', () => {
    const intensity = detectEmotionIntensity('The weather is nice today.');
    expect(intensity).toBeLessThan(0.3);
  });

  it('returns higher intensity for exclamation marks', () => {
    const plain = detectEmotionIntensity('I am happy.');
    const excited = detectEmotionIntensity('I am happy!!! So excited!!!');
    expect(excited).toBeGreaterThan(plain);
  });

  it('returns higher intensity for ALL CAPS', () => {
    const lower = detectEmotionIntensity('I feel happy about this.');
    const upper = detectEmotionIntensity('I FEEL HAPPY ABOUT THIS.');
    expect(upper).toBeGreaterThan(lower);
  });

  it('returns higher intensity for repeated punctuation', () => {
    const single = detectEmotionIntensity('Really? Wow.');
    const repeated = detectEmotionIntensity('Really??? WOW!!!');
    expect(repeated).toBeGreaterThan(single);
  });

  it('returns higher intensity for emotional vocabulary', () => {
    const neutral = detectEmotionIntensity('The process completed successfully.');
    const emotional = detectEmotionIntensity('I feel such deep compassion and love for this beautiful experience.');
    expect(emotional).toBeGreaterThan(neutral);
  });

  it('caps at 1.0', () => {
    const extreme = detectEmotionIntensity('AMAZING!!! WONDERFUL!!! I LOVE THIS!!! SO HAPPY!!! GRATEFUL!!! EXCITED!!!');
    expect(extreme).toBeLessThanOrEqual(1.0);
  });
});
