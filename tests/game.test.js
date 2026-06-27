import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, movePlayer, getVisibleBounds } from '../src/game.js';

test('createInitialState starts the king at the center and spawns enemies', () => {
  const state = createInitialState();

  assert.equal(state.player.x, 8);
  assert.equal(state.player.y, 8);
  assert.ok(state.enemies.length >= 3);
});

test('movePlayer updates the position and triggers an enemy turn', () => {
  const state = createInitialState();
  const next = movePlayer(state, 1, 0);

  assert.equal(next.player.x, 9);
  assert.equal(next.turn, 1);
  assert.equal(next.enemyTurn, true);
});

test('visible bounds are centered on the player and match an 8x8 board', () => {
  const state = createInitialState();
  const bounds = getVisibleBounds(state);

  assert.equal(bounds.width, 8);
  assert.equal(bounds.height, 8);
  assert.equal(bounds.x, 4);
  assert.equal(bounds.y, 4);
});
