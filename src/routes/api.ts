import express, { type Request, type Response, type Router } from 'express';
import QRCode from 'qrcode';
import { buildDecisionLogCsv, buildRoundSummaryCsv, normalizeRoomCode } from '../game/engine.js';
import { GameError, type GameStore } from '../game/store.js';

function getOrigin(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.get('host') ?? 'localhost:3000';
  const hostStr = Array.isArray(host) ? host[0] : host;
  return `${proto}://${hostStr}`;
}

function getHostSecretFromReq(req: Request): string {
  const headerVal = req.headers['x-host-secret'];
  if (typeof headerVal === 'string' && headerVal.trim()) return headerVal.trim();
  const queryVal = req.query.hostSecret;
  if (typeof queryVal === 'string' && queryVal.trim()) return queryVal.trim();
  const bodyVal = (req.body as Record<string, unknown> | undefined)?.hostSecret;
  if (typeof bodyVal === 'string' && bodyVal.trim()) return bodyVal.trim();
  return '';
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof GameError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  res.status(500).json({ error: message });
}

export function createApiRouter(store: GameStore, onRoomChanged: (roomCode: string) => void): Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, storage: store.storageKind });
  });

  router.post('/sessions', (req, res) => {
    try {
      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : undefined;
      if (passcode && passcode.trim().length > 0 && passcode.trim().length < 4) {
        throw new GameError('Custom instructor passcode must be at least 4 characters (or leave blank to auto-generate).', 400);
      }
      const session = store.createSession(passcode);
      const origin = getOrigin(req);
      res.status(201).json({
        roomCode: session.roomCode,
        hostSecret: session.hostSecret,
        joinUrl: `${origin}/play/${session.roomCode}`,
        masterUrl: `${origin}/master/${session.roomCode}`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/sessions/:roomCode', (req, res) => {
    try {
      const roomCode = normalizeRoomCode(req.params.roomCode);
      const session = store.getSession(roomCode);
      if (!session) {
        res.status(404).json({ error: 'Room not found. Double-check your room code.' });
        return;
      }
      const activeRound = store.getActiveRound(session);
      res.json({
        roomCode: session.roomCode,
        activeRoundNumber: session.activeRoundNumber,
        roundStatus: activeRound?.status ?? null,
        groups: store.listPublicGroups(session.roomCode),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/sessions/:roomCode/verify-host', (req, res) => {
    try {
      const hostSecret = getHostSecretFromReq(req);
      const session = store.verifyHost(req.params.roomCode, hostSecret);
      res.json({ ok: true, roomCode: session.roomCode });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/sessions/:roomCode/groups', (req, res) => {
    try {
      const groupName = typeof req.body?.groupName === 'string' ? req.body.groupName : '';
      const { session, group } = store.createGroup(req.params.roomCode, groupName);
      onRoomChanged(session.roomCode);
      res.status(201).json({
        roomCode: session.roomCode,
        group: {
          id: group.id,
          name: group.name,
          teamCode: group.teamCode,
          joinToken: group.joinToken,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/sessions/:roomCode/groups/join', (req, res) => {
    try {
      const groupId = typeof req.body?.groupId === 'string' ? req.body.groupId : undefined;
      const teamCode = typeof req.body?.teamCode === 'string' ? req.body.teamCode : undefined;
      const joinToken = typeof req.body?.joinToken === 'string' ? req.body.joinToken : undefined;
      const { session, group } = store.joinExistingGroup(req.params.roomCode, {
        groupId,
        teamCode,
        joinToken,
      });
      res.json({
        roomCode: session.roomCode,
        group: {
          id: group.id,
          name: group.name,
          teamCode: group.teamCode,
          joinToken: group.joinToken,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/sessions/:roomCode/qr', async (req, res) => {
    try {
      const session = store.requireSession(req.params.roomCode);
      const origin = getOrigin(req);
      const joinUrl = `${origin}/play/${session.roomCode}`;
      const svg = await QRCode.toString(joinUrl, {
        type: 'svg',
        margin: 2,
        color: {
          dark: '#24313b',
          light: '#fffaf2',
        },
      });
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(svg);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/sessions/:roomCode/export/summary.csv', (req, res) => {
    try {
      const hostSecret = getHostSecretFromReq(req);
      const session = store.verifyHost(req.params.roomCode, hostSecret);
      const roundParam = typeof req.query.round === 'string' ? Number.parseInt(req.query.round, 10) : undefined;
      const roundNumber = Number.isInteger(roundParam) ? roundParam : undefined;
      const csv = buildRoundSummaryCsv(session, roundNumber);
      const suffix = roundNumber ? `round-${roundNumber}` : 'all-rounds';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="guessK-${session.roomCode}-${suffix}-summary.csv"`);
      res.send(csv);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/sessions/:roomCode/export/events.csv', (req, res) => {
    try {
      const hostSecret = getHostSecretFromReq(req);
      const session = store.verifyHost(req.params.roomCode, hostSecret);
      const roundParam = typeof req.query.round === 'string' ? Number.parseInt(req.query.round, 10) : undefined;
      const roundNumber = Number.isInteger(roundParam) ? roundParam : undefined;
      const csv = buildDecisionLogCsv(session, roundNumber);
      const suffix = roundNumber ? `round-${roundNumber}` : 'all-rounds';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="guessK-${session.roomCode}-${suffix}-decisions.csv"`);
      res.send(csv);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
