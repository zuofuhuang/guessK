import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { buildMasterView, buildStudentView, normalizeRoomCode } from './game/engine.js';
import { GameError, GameStore } from './game/store.js';
import type { RoundStatus, SamplingMode } from './game/types.js';
import { createApiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const OFFLINE_DIR = path.join(ROOT_DIR, 'offline');

interface SocketMeta {
  role: 'master' | 'student' | null;
  roomCode: string | null;
  hostSecret?: string;
  groupId?: string;
  joinToken?: string;
}

type AckFn = (response: Record<string, unknown>) => void;

export interface RunningAppServer {
  app: express.Express;
  httpServer: http.Server;
  io: SocketIOServer;
  store: GameStore;
  port: number;
  close: () => Promise<void>;
}

export async function createAppServer(opts?: {
  port?: number;
  host?: string;
  storagePath?: string;
}): Promise<RunningAppServer> {
  const store = await GameStore.create(opts?.storagePath);
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  // Track active connections per roomCode -> groupId -> count
  const roomGroupConnections = new Map<string, Map<string, number>>();
  const socketMetaMap = new Map<string, SocketMeta>();

  function getRoomConnections(roomCode: string): Map<string, number> {
    let map = roomGroupConnections.get(roomCode);
    if (!map) {
      map = new Map<string, number>();
      roomGroupConnections.set(roomCode, map);
    }
    return map;
  }

  function adjustGroupConnection(roomCode: string, groupId: string, delta: number): void {
    const map = getRoomConnections(roomCode);
    const next = Math.max(0, (map.get(groupId) ?? 0) + delta);
    if (next === 0) {
      map.delete(groupId);
    } else {
      map.set(groupId, next);
    }
  }

  function broadcastMasterState(roomCode: string): void {
    const session = store.getSession(roomCode);
    if (!session) return;
    const view = buildMasterView(session, getRoomConnections(roomCode));
    io.to(`master:${roomCode}`).emit('master:state', view);
  }

  function broadcastGroupState(roomCode: string, groupId: string): void {
    const session = store.getSession(roomCode);
    if (!session) return;
    const view = buildStudentView(session, groupId, getRoomConnections(roomCode));
    if (view) {
      io.to(`group:${roomCode}:${groupId}`).emit('student:state', view);
    }
  }

  function broadcastAllGroupsInRoom(roomCode: string): void {
    const session = store.getSession(roomCode);
    if (!session) return;
    const connections = getRoomConnections(roomCode);
    for (const groupId of Object.keys(session.groups)) {
      const view = buildStudentView(session, groupId, connections);
      if (view) {
        io.to(`group:${roomCode}:${groupId}`).emit('student:state', view);
      }
    }
  }

  function broadcastRoomFull(roomCode: string): void {
    broadcastMasterState(roomCode);
    broadcastAllGroupsInRoom(roomCode);
  }

  function safeAck(ack: AckFn | undefined, payload: Record<string, unknown>): void {
    if (typeof ack === 'function') {
      ack(payload);
    }
  }

  function errorMessage(err: unknown): string {
    if (err instanceof GameError) return err.message;
    return err instanceof Error ? err.message : 'Unexpected server error.';
  }

  // REST API
  app.use('/api', createApiRouter(store, (roomCode) => broadcastRoomFull(roomCode)));

  // Static files & preserved offline version
  app.use(express.static(PUBLIC_DIR));
  app.use('/offline', express.static(OFFLINE_DIR));

  // Page routes
  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.get('/play/:roomCode', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'play.html'));
  });

  app.get('/master/:roomCode', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'master.html'));
  });

  // Socket.IO realtime layer
  io.on('connection', (socket: Socket) => {
    socketMetaMap.set(socket.id, { role: null, roomCode: null });

    socket.on('master:auth', (payload: { roomCode?: string; hostSecret?: string }, ack?: AckFn) => {
      try {
        const roomCode = normalizeRoomCode(payload?.roomCode ?? '');
        const hostSecret = typeof payload?.hostSecret === 'string' ? payload.hostSecret.trim() : '';
        const session = store.verifyHost(roomCode, hostSecret);

        // Clean previous binding if re-authing on same socket
        const prev = socketMetaMap.get(socket.id);
        if (prev?.role === 'master' && prev.roomCode) {
          socket.leave(`master:${prev.roomCode}`);
        }

        socketMetaMap.set(socket.id, {
          role: 'master',
          roomCode: session.roomCode,
          hostSecret,
        });
        socket.join(`master:${session.roomCode}`);

        const view = buildMasterView(session, getRoomConnections(session.roomCode));
        socket.emit('master:state', view);
        safeAck(ack, { ok: true, state: view });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('master:start_round', (payload: { secretK?: unknown; samplingMode?: SamplingMode }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'master' || !meta.roomCode || !meta.hostSecret) {
          throw new GameError('Not authenticated as instructor.', 403);
        }
        const { session, round } = store.startRound(meta.roomCode, meta.hostSecret, {
          secretK: payload?.secretK,
          samplingMode: payload?.samplingMode,
        });
        broadcastRoomFull(session.roomCode);
        safeAck(ack, { ok: true, roundNumber: round.roundNumber });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('master:set_status', (payload: { status?: RoundStatus }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'master' || !meta.roomCode || !meta.hostSecret) {
          throw new GameError('Not authenticated as instructor.', 403);
        }
        const nextStatus = payload?.status;
        if (nextStatus !== 'active' && nextStatus !== 'locked' && nextStatus !== 'revealed') {
          throw new GameError('Invalid round status.', 400);
        }
        const { session, round } = store.setRoundStatus(meta.roomCode, meta.hostSecret, nextStatus);
        broadcastRoomFull(session.roomCode);
        safeAck(ack, { ok: true, status: round.status });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('master:unlock_group', (payload: { groupId?: string }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'master' || !meta.roomCode || !meta.hostSecret) {
          throw new GameError('Not authenticated as instructor.', 403);
        }
        const groupId = typeof payload?.groupId === 'string' ? payload.groupId : '';
        const { session, group } = store.unlockGroupGuess(meta.roomCode, meta.hostSecret, groupId);
        broadcastRoomFull(session.roomCode);
        io.to(`group:${session.roomCode}:${group.id}`).emit('student:notice', {
          message: 'Your instructor unlocked your guess. You may request more numbers or submit a revised guess.',
        });
        safeAck(ack, { ok: true });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('master:remove_group', (payload: { groupId?: string }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'master' || !meta.roomCode || !meta.hostSecret) {
          throw new GameError('Not authenticated as instructor.', 403);
        }
        const groupId = typeof payload?.groupId === 'string' ? payload.groupId : '';
        const { session, removedName } = store.removeGroup(meta.roomCode, meta.hostSecret, groupId);
        io.to(`group:${session.roomCode}:${groupId}`).emit('student:removed', {
          message: `Group "${removedName}" was removed by the instructor.`,
        });
        getRoomConnections(session.roomCode).delete(groupId);
        broadcastRoomFull(session.roomCode);
        safeAck(ack, { ok: true, removedName });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('student:auth', (payload: { roomCode?: string; joinToken?: string }, ack?: AckFn) => {
      try {
        const roomCode = normalizeRoomCode(payload?.roomCode ?? '');
        const joinToken = typeof payload?.joinToken === 'string' ? payload.joinToken.trim() : '';
        const { session, group } = store.authenticateGroup(roomCode, joinToken);

        const prev = socketMetaMap.get(socket.id);
        if (prev?.role === 'student' && prev.roomCode && prev.groupId) {
          adjustGroupConnection(prev.roomCode, prev.groupId, -1);
          socket.leave(`group:${prev.roomCode}:${prev.groupId}`);
        }

        socketMetaMap.set(socket.id, {
          role: 'student',
          roomCode: session.roomCode,
          groupId: group.id,
          joinToken,
        });

        socket.join(`group:${session.roomCode}:${group.id}`);
        adjustGroupConnection(session.roomCode, group.id, 1);

        const view = buildStudentView(session, group.id, getRoomConnections(session.roomCode));
        broadcastGroupState(session.roomCode, group.id);
        broadcastMasterState(session.roomCode);
        safeAck(ack, { ok: true, state: view });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('student:draw', (payload: { count?: unknown }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'student' || !meta.roomCode || !meta.joinToken || !meta.groupId) {
          throw new GameError('Please join a group first.', 401);
        }
        const { session, group, newDraws } = store.requestDraws(meta.roomCode, meta.joinToken, payload?.count);
        broadcastGroupState(session.roomCode, group.id);
        broadcastMasterState(session.roomCode);
        safeAck(ack, { ok: true, newDraws });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('student:submit_guess', (payload: { guess?: unknown }, ack?: AckFn) => {
      try {
        const meta = socketMetaMap.get(socket.id);
        if (!meta || meta.role !== 'student' || !meta.roomCode || !meta.joinToken || !meta.groupId) {
          throw new GameError('Please join a group first.', 401);
        }
        const { session } = store.submitGuess(meta.roomCode, meta.joinToken, payload?.guess);
        // Broadcast full room so every group sees updated submittedCount (never other guesses!)
        broadcastRoomFull(session.roomCode);
        safeAck(ack, { ok: true });
      } catch (err) {
        safeAck(ack, { ok: false, error: errorMessage(err) });
      }
    });

    socket.on('disconnect', () => {
      const meta = socketMetaMap.get(socket.id);
      socketMetaMap.delete(socket.id);
      if (meta?.role === 'student' && meta.roomCode && meta.groupId) {
        adjustGroupConnection(meta.roomCode, meta.groupId, -1);
        broadcastGroupState(meta.roomCode, meta.groupId);
        broadcastMasterState(meta.roomCode);
      }
    });
  });

  const listenPort = opts?.port ?? Number.parseInt(process.env.PORT ?? '3000', 10);
  const listenHost = opts?.host ?? '0.0.0.0';

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(listenPort, listenHost, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : listenPort;

  const close = async () => {
    await new Promise<void>((resolve) => {
      io.close(() => {
        httpServer.close(() => {
          store.close();
          resolve();
        });
      });
    });
  };

  return { app, httpServer, io, store, port: actualPort, close };
}

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  createAppServer()
    .then((server) => {
      console.log(`Guess the Hidden K server running on http://localhost:${server.port}`);
      for (const lanUrl of getLanUrls(server.port)) {
        console.log(`  Classroom LAN: ${lanUrl}`);
      }
      console.log(`  Persistence:   ${server.store.storageKind}`);

      const shutdown = async () => {
        await server.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start Guess the Hidden K server:', err);
      process.exit(1);
    });
}
