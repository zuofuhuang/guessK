import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import type { MasterView, StudentView } from '../src/game/types.js';

function emitAck<T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ack on ${event}`)), 5000);
    socket.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function waitForEvent<T>(socket: Socket, event: string, predicate?: (data: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 5000);

    const onEvent = (data: T) => {
      if (!predicate || predicate(data)) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(data);
      }
    };

    socket.on(event, onEvent);
  });
}

test('End-to-end real-time classroom session: master + 2 groups + multi-device team sync + reveal + exports', async () => {
  const server = await createAppServer({ port: 0, host: '127.0.0.1', storagePath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  const sockets: Socket[] = [];
  const connect = () => {
    const s = ioClient(baseUrl, { transports: ['websocket'] });
    sockets.push(s);
    return new Promise<Socket>((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  };

  try {
    // 1. Instructor creates room via REST
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'stat101' }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      roomCode: string;
      hostSecret: string;
      joinUrl: string;
    };
    assert.equal(created.roomCode.length, 6);
    assert.equal(created.hostSecret, 'stat101');

    // QR SVG endpoint works
    const qrRes = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/qr`);
    assert.equal(qrRes.status, 200);
    const qrSvg = await qrRes.text();
    assert.match(qrSvg, /<svg/i);

    // 2. Two student groups join via REST, plus a teammate joins Group 1 using Team PIN
    const g1Res = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'Team Bayes' }),
    });
    assert.equal(g1Res.status, 201);
    const g1Data = (await g1Res.json()) as {
      group: { id: string; name: string; teamCode: string; joinToken: string };
    };

    // Wrong Team PIN rejected
    const badPinRes = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: g1Data.group.id, teamCode: '0000' }),
    });
    assert.equal(badPinRes.status, 403);

    // Correct Team PIN succeeds for teammate on second device
    const teammateRes = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: g1Data.group.id, teamCode: g1Data.group.teamCode }),
    });
    assert.equal(teammateRes.status, 200);
    const teammateData = (await teammateRes.json()) as {
      group: { id: string; joinToken: string };
    };

    const g2Res = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'Team Fisher' }),
    });
    assert.equal(g2Res.status, 201);
    const g2Data = (await g2Res.json()) as {
      group: { id: string; name: string; teamCode: string; joinToken: string };
    };

    // 3. Connect Master + Group 1 (2 devices) + Group 2 via Socket.IO
    const [masterSock, g1DevA, g1DevB, g2Sock] = await Promise.all([
      connect(),
      connect(),
      connect(),
      connect(),
    ]);

    const masterAuth = await emitAck<{ ok: boolean; state: MasterView }>(masterSock, 'master:auth', {
      roomCode: created.roomCode,
      hostSecret: created.hostSecret,
    });
    assert.equal(masterAuth.ok, true);
    assert.equal(masterAuth.state.groups.length, 2);

    const g1AuthA = await emitAck<{ ok: boolean; state: StudentView }>(g1DevA, 'student:auth', {
      roomCode: created.roomCode,
      joinToken: g1Data.group.joinToken,
    });
    const g1AuthB = await emitAck<{ ok: boolean; state: StudentView }>(g1DevB, 'student:auth', {
      roomCode: created.roomCode,
      joinToken: teammateData.group.joinToken,
    });
    const g2Auth = await emitAck<{ ok: boolean; state: StudentView }>(g2Sock, 'student:auth', {
      roomCode: created.roomCode,
      joinToken: g2Data.group.joinToken,
    });
    assert.equal(g1AuthA.ok, true);
    assert.equal(g1AuthB.ok, true);
    assert.equal(g1AuthB.state.group.connectedDevices, 2);
    assert.equal(g2Auth.ok, true);

    // 4. Master starts Round 1 with secretK = 75
    const g1RoundStarted = waitForEvent<StudentView>(
      g1DevA,
      'student:state',
      (s) => s.round?.roundNumber === 1
    );
    const startAck = await emitAck<{ ok: boolean; roundNumber: number }>(
      masterSock,
      'master:start_round',
      { secretK: 75, samplingMode: 'independent' }
    );
    assert.equal(startAck.ok, true);
    assert.equal(startAck.roundNumber, 1);

    const g1RoundState = await g1RoundStarted;
    assert.equal(g1RoundState.round?.secretK, null); // Never leaked!

    // 5. Group 1 Device A requests 5 draws -> Device B and Master receive live sync
    const devBSync = waitForEvent<StudentView>(g1DevB, 'student:state', (s) => s.round?.count === 5);
    const masterSync = waitForEvent<MasterView>(
      masterSock,
      'master:state',
      (m) => m.rounds[0]?.groups.find((g) => g.groupId === g1Data.group.id)?.requestedCount === 5
    );

    const drawAck = await emitAck<{ ok: boolean; newDraws: number[] }>(g1DevA, 'student:draw', {
      count: 5,
    });
    assert.equal(drawAck.ok, true);
    assert.equal(drawAck.newDraws.length, 5);

    const syncedB = await devBSync;
    assert.equal(syncedB.round?.count, 5);
    assert.equal(syncedB.round?.secretK, null);

    const masterAfterDraw = await masterSync;
    assert.equal(masterAfterDraw.rounds[0].groups.find((g) => g.groupId === g1Data.group.id)?.requestedCount, 5);

    // 6. Group 2 requests 3 draws, both groups lock in guesses
    await emitAck(g2Sock, 'student:draw', { count: 3 });

    const g1SubmitAck = await emitAck<{ ok: boolean }>(g1DevB, 'student:submit_guess', { guess: 75 });
    const g2SubmitAck = await emitAck<{ ok: boolean }>(g2Sock, 'student:submit_guess', { guess: 70 });
    assert.equal(g1SubmitAck.ok, true);
    assert.equal(g2SubmitAck.ok, true);

    // Duplicate submission blocked
    const dupAck = await emitAck<{ ok: boolean; error?: string }>(g1DevA, 'student:submit_guess', {
      guess: 80,
    });
    assert.equal(dupAck.ok, false);

    // 7. Master reveals K -> all students receive actual K = 75 and accurate scores
    const g1Revealed = waitForEvent<StudentView>(
      g1DevA,
      'student:state',
      (s) => s.round?.status === 'revealed'
    );
    const revealAck = await emitAck<{ ok: boolean }>(masterSock, 'master:set_status', {
      status: 'revealed',
    });
    assert.equal(revealAck.ok, true);

    const revealedState = await g1Revealed;
    assert.equal(revealedState.round?.secretK, 75);
    assert.equal(revealedState.round?.absError, 0);
    assert.equal(revealedState.round?.score, 20); // 100 / (5 + 0)
    assert.equal(revealedState.round?.rank, 1);

    // 8. CSV Exports require host secret and return valid CSV
    const unauthCsv = await fetch(`${baseUrl}/api/sessions/${created.roomCode}/export/summary.csv`);
    assert.equal(unauthCsv.status, 403);

    const summaryCsvRes = await fetch(
      `${baseUrl}/api/sessions/${created.roomCode}/export/summary.csv?hostSecret=${created.hostSecret}`
    );
    assert.equal(summaryCsvRes.status, 200);
    const summaryCsv = await summaryCsvRes.text();
    assert.match(summaryCsv, /Team Bayes/);
    assert.match(summaryCsv, /Team Fisher/);
    assert.match(summaryCsv, /75/);

    const eventsCsvRes = await fetch(
      `${baseUrl}/api/sessions/${created.roomCode}/export/events.csv?hostSecret=${created.hostSecret}`
    );
    assert.equal(eventsCsvRes.status, 200);
    const eventsCsv = await eventsCsvRes.text();
    assert.match(eventsCsv, /round_revealed/);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await server.close();
  }
});

test('SQLite persistence preserves sessions, rounds, and cumulative totals across server restarts', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guessk-persist-'));

  try {
    const server1 = await createAppServer({ port: 0, host: '127.0.0.1', storagePath: tmpDir });
    let roomCode = '';
    try {
      const session = server1.store.createSession('persist123');
      roomCode = session.roomCode;
      const { group } = server1.store.createGroup(roomCode, 'Group Persist');

      // Round 1
      server1.store.startRound(roomCode, 'persist123', { secretK: 30, samplingMode: 'independent' });
      server1.store.requestDraws(roomCode, group.joinToken, 4);
      server1.store.submitGuess(roomCode, group.joinToken, 30); // score = 100 / 4 = 25
      server1.store.setRoundStatus(roomCode, 'persist123', 'locked');
      server1.store.setRoundStatus(roomCode, 'persist123', 'revealed');
      server1.store.setRoundStatus(roomCode, 'persist123', 'locked'); // Hide K again
      server1.store.setRoundStatus(roomCode, 'persist123', 'revealed');

      // Round 2
      server1.store.startRound(roomCode, 'persist123', { secretK: 50, samplingMode: 'shared' });
      server1.store.requestDraws(roomCode, group.joinToken, 5);
      server1.store.submitGuess(roomCode, group.joinToken, 45); // score = 100 / (5 + 5) = 10
      server1.store.setRoundStatus(roomCode, 'persist123', 'revealed');
    } finally {
      await server1.close();
    }

    // Boot a completely fresh server pointing at the same storage directory
    const server2 = await createAppServer({ port: 0, host: '127.0.0.1', storagePath: tmpDir });
    try {
      const reloaded = server2.store.getSession(roomCode);
      assert.ok(reloaded, 'Session should reload from disk');
      assert.equal(reloaded.rounds.length, 2);
      assert.equal(reloaded.activeRoundNumber, 2);
      const groupId = Object.keys(reloaded.groups)[0];
      assert.equal(reloaded.rounds[0].groupStates[groupId].score, 25);
      assert.equal(reloaded.rounds[1].groupStates[groupId].score, 10);
    } finally {
      await server2.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Split hosting CORS, preflight, /config.js, and Origin-aware join/QR URLs work cleanly', async () => {
  const cfOrigin = 'https://guessk-web.example.workers.dev';
  const server = await createAppServer({
    port: 0,
    host: '127.0.0.1',
    storagePath: ':memory:',
    corsOrigin: cfOrigin,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    // /config.js served cleanly on Node
    const cfgRes = await fetch(`${baseUrl}/config.js`);
    assert.equal(cfgRes.status, 200);
    assert.match(await cfgRes.text(), /GUESSK_CONFIG/);

    // Preflight OPTIONS request returns 204 with allowed origin
    const preflight = await fetch(`${baseUrl}/api/sessions`, {
      method: 'OPTIONS',
      headers: { Origin: cfOrigin },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), cfOrigin);

    // Creating a session from Cloudflare origin sets joinUrl to Cloudflare domain
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: cfOrigin,
      },
      body: JSON.stringify({ passcode: 'split123' }),
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.headers.get('access-control-allow-origin'), cfOrigin);
    const created = (await createRes.json()) as { roomCode: string; joinUrl: string };
    assert.equal(created.joinUrl, `${cfOrigin}/play/${created.roomCode}`);

    // Disallowed origin does not receive ACAO header
    const otherRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(otherRes.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});
