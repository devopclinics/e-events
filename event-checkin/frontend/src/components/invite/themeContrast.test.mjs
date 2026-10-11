import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableColor, contrastRatio, welcomeColors } from './themeContrast.mjs';

test('keeps readable brand text and replaces invisible white-on-cream text', () => {
  assert.equal(readableColor('#ffffff', '#183e34'), '#183e34');
  assert.ok(contrastRatio(readableColor('#ececcc', '#ffffff'), '#ececcc') >= 4.5);
});

test('custom light, dark, and low-contrast palettes remain readable on every themed surface', () => {
  for (const background of ['#ffffff', '#000000', '#777777', '#ffff00', '#ff00ff', '#00ff00', '#14b8a6']) {
    for (const text of ['#ffffff', '#000000', background]) {
      const colors = welcomeColors({ background, surface: background, primary: background, accent: background, text });
      for (const [ink, surface] of [['--rw-ink', '--rw-surface'], ['--rw-primary-ink', '--rw-primary'], ['--rw-accent-ink', '--rw-accent']])
        assert.ok(contrastRatio(colors[ink], colors[surface]) >= 4.5, `${ink} on ${surface}`);
      assert.ok(contrastRatio(colors['--rw-hero-ink'], '#ececcc') >= 4.5);
    }
  }
});

test('invalid custom color values use safe readable defaults', () => {
  const colors = welcomeColors({ primary: 'url(x)', surface: 'transparent', text: 'white' });
  assert.equal(colors['--rw-primary'], '#194e3e');
  assert.equal(colors['--rw-surface'], '#ffffff');
  assert.ok(contrastRatio(colors['--rw-ink'], colors['--rw-surface']) >= 4.5);
});
