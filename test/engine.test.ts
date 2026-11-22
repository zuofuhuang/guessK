import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionLogCsv,
  buildMasterView,
  buildRoundSummaryCsv,
  buildStudentView,
  calculateScore,
  computeSampleStats,
  validateDrawCount,
  validateGuess,
  validateK,
} from '../src/game/engine.js';
import { GameStore } from '../src/game/store.js';

test('calculateScore matches exact formula 100 / (n + |guess - K|)', () => {
  const exact = calculateScore(10, 50, 50);
  assert.equal(exact.absError, 0);
  assert.equal(exact.score, 10);

  const offBy5 = calculateScore(5, 45, 50);
  assert.equal(offBy5.absError, 5);
  assert.equal(offBy5.score, 10);

  const overGuess = calculateScore(3, 27, 20);
  assert.equal(overGuess.absError, 7);
  assert.equal(overGuess.score, 10);

  assert.throws(() => calculateScore(0, 20, 20), /At least 1 number/);
});

test('validators enforce game constraints', () => {
  assert.equal(validateK(1).ok, false);
  assert.equal(validateK(2).ok, true);
  assert.equal(validateK('45').ok, true);
  assert.equal(validateK('abc').ok, false);

  assert.equal(validateDrawCount(0, 0).ok, false);
  assert.equal(validateDrawCount(10, 0).ok, true);
  assert.equal(validateDrawCount(101, 0).ok, false);
  assert.equal(validateDrawCount(50, 1960).ok, false);

  assert.equal(validateGuess(0).ok, false);
  assert.equal(validateGuess(1).ok, true);
  assert.equal(validateGuess('99').ok, true);
});

test('computeSampleStats sorts draws and computes Intro Stats estimators', () => {
  const stats = computeSampleStats([12, 4, 18, 4, 12]);
  assert.equal(stats.count, 5);
  assert.deepEqual(stats.sortedDraws, [4, 4, 12, 12, 18]);
  assert.equal(stats.min, 4);
  assert.equal(stats.max, 18);
  assert.equal(stats.mean, 10);
  assert.equal(stats.momEstimate, 19); // 2*10 - 1
  assert.equal(Number(stats.maxAdjustedEstimate?.toFixed(2)), 21.6); // (6/5)*18
});

test('GameStore enforces secret isolation, single guess lock, shared stream, and CSV exports', async () => {
  const store = await GameStore.create(':memory:');
  try {
    const session = store.createSession('prof1234');
    const { group: g1 } = store.createGroup(session.roomCode, 'Group Alpha');
    const { group: g2 } = store.createGroup(session.roomCode, 'Group Beta');

    // Start Round 1 in shared mode so both groups must observe identical prefixes
    store.startRound(session.roomCode, session.hostSecret, {
      secretK: 40,
      samplingMode: 'shared',
    });

    // Cannot submit with 0 draws
    assert.throws(() => store.submitGuess(session.roomCode, g1.joinToken, 38), /at least 1 number/i);

    const draw1 = store.requestDraws(session.roomCode, g1.joinToken, 5);
    const draw2 = store.requestDraws(session.roomCode, g2.joinToken, 3);
    const draw2b = store.requestDraws(session.roomCode, g2.joinToken, 2);

    assert.equal(draw1.newDraws.length, 5);
    assert.deepEqual([...draw2.newDraws, ...draw2b.newDraws], draw1.newDraws);
    for (const v of draw1.newDraws) {
      assert.ok(v >= 1 && v <= 40);
    }

    // Group 1 locks in guess
    store.submitGuess(session.roomCode, g1.joinToken, 42);

    // Group 1 cannot draw again or submit a second guess
    assert.throws(() => store.requestDraws(session.roomCode, g1.joinToken, 1), /already locked/i);
    assert.throws(() => store.submitGuess(session.roomCode, g1.joinToken, 40), /already submitted/i);

    // STRICT SECRET ISOLATION: Student view before reveal must NOT contain secretK, absError, score, or leaderboard
    const preRevealView = buildStudentView(session, g1.id, new Map([[g1.id, 1]]));
    assert.ok(preRevealView?.round);
    assert.equal(preRevealView.round.secretK, null);
    assert.equal(preRevealView.round.absError, null);
    assert.equal(preRevealView.round.score, null);
    assert.equal(preRevealView.round.leaderboard, null);
    assert.equal(preRevealView.round.guess, 42);

    // Instructor unlocks Group 1 -> they can revise
    store.unlockGroupGuess(session.roomCode, session.hostSecret, g1.id);
    store.submitGuess(session.roomCode, g1.joinToken, 40);
    store.submitGuess(session.roomCode, g2.joinToken, 35);

    // Reveal round
    store.setRoundStatus(session.roomCode, session.hostSecret, 'revealed');
    const postRevealView = buildStudentView(session, g1.id, new Map([[g1.id, 1]]));
    assert.equal(postRevealView?.round?.secretK, 40);
    assert.equal(postRevealView?.round?.absError, 0);
    assert.equal(postRevealView?.round?.score, 20); // 100 / (5 + 0)
    assert.equal(postRevealView?.round?.rank, 1);
    assert.equal(postRevealView?.round?.leaderboard?.length, 2);

    // Master view includes full analytics & cumulative table
    const masterView = buildMasterView(session, new Map([[g1.id, 2], [g2.id, 1]]));
    assert.equal(masterView.rounds.length, 1);
    assert.equal(masterView.rounds[0].summary.topScore, 20);
    assert.deepEqual(masterView.rounds[0].summary.topScorerNames, ['Group Alpha']);
    assert.equal(masterView.cumulative[0].groupName, 'Group Alpha');

    // CSV builders work and include expected rows
    const summaryCsv = buildRoundSummaryCsv(session, 1);
    assert.match(summaryCsv, /Group Alpha/);
    assert.match(summaryCsv, /Group Beta/);
    assert.match(summaryCsv, /20\.0000/);

    const eventsCsv = buildDecisionLogCsv(session, 1);
    assert.match(eventsCsv, /draw/);
    assert.match(eventsCsv, /unlock/);
    assert.match(eventsCsv, /submit/);
    assert.match(eventsCsv, /round_revealed/);
  } finally {
    store.close();
  }
});
