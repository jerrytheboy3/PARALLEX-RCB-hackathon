import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const bank = JSON.parse(readFileSync(new URL('../data/cyberQuiz.json', import.meta.url), 'utf8'));
const qs = bank.questions;

describe('data/cyberQuiz.json', () => {
  it('has at least 100 well-formed questions', () => {
    expect(qs.length).toBeGreaterThanOrEqual(100);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    for (const q of qs) {
      expect(Object.keys(q).sort(), q.id).toEqual(['category', 'correctIndex', 'difficulty', 'explanation', 'id', 'options', 'question', 'redFlags', 'scenario']);
      expect(['easy', 'medium', 'hard'], q.id).toContain(q.difficulty);
      expect(q.options, q.id).toHaveLength(4);
      expect(new Set(q.options).size, `${q.id} duplicate options`).toBe(4);
      expect(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4, q.id).toBe(true);
      expect(q.redFlags.length, q.id).toBeGreaterThanOrEqual(2);
      expect(q.redFlags.length, q.id).toBeLessThanOrEqual(3);
      expect(q.scenario.length, q.id).toBeGreaterThan(40);
      expect(q.explanation.length, q.id).toBeGreaterThan(40);
      expect(Object.keys(bank.categories), q.id).toContain(q.category);
    }
  });

  it('covers every category, with at least 20 on new techniques', () => {
    const per = {};
    for (const q of qs) per[q.category] = (per[q.category] || 0) + 1;
    for (const c of Object.keys(bank.categories)) expect(per[c], c).toBeGreaterThanOrEqual(4);
    expect(per.new).toBeGreaterThanOrEqual(20);
  });

  it('spreads the correct answer across positions', () => {
    const at = [0, 0, 0, 0];
    for (const q of qs) at[q.correctIndex]++;
    for (const n of at) expect(n).toBeGreaterThan(qs.length / 8);
  });
});
