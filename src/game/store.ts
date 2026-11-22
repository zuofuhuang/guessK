import fs from 'node:fs';
import path from 'node:path';
import {
  calculateScore,
  computeSampleStats,
  createEmptyGroupRoundState,
  drawNumbersForGroup,
  generateEventId,
  generateRoomCode,
  generateTeamCode,
  generateToken,
  normalizeRoomCode,
  sanitizeGroupName,
  validateDrawCount,
  validateGuess,
  validateK,
} from './engine.js';
import type { DecisionEvent, Group, Round, RoundStatus, SamplingMode, Session } from './types.js';

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface PersistenceAdapter {
  kind: 'sqlite' | 'json' | 'memory';
  loadAll(): Session[];
  save(session: Session): void;
  close(): void;
}

async function createPersistenceAdapter(storagePath?: string): Promise<PersistenceAdapter> {
  if (storagePath === ':memory:') {
    return {
      kind: 'memory',
      loadAll: () => [],
      save: () => {},
      close: () => {},
    };
  }

  const dataDir = path.resolve(storagePath ?? path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  try {
    const sqliteMod = (await import('node:sqlite')) as {
      DatabaseSync: new (location: string) => SqliteDatabase;
    };
    const dbFile = path.join(dataDir, 'guessk.db');
    const db = new sqliteMod.DatabaseSync(dbFile);
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        room_code TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const selectAll = db.prepare('SELECT payload FROM sessions');
    const upsert = db.prepare(
      'INSERT INTO sessions (room_code, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(room_code) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    );

    return {
      kind: 'sqlite',
      loadAll() {
        const rows = selectAll.all();
        const sessions: Session[] = [];
        for (const row of rows) {
          if (typeof row.payload === 'string') {
            try {
              sessions.push(JSON.parse(row.payload) as Session);
            } catch {
              // Ignore malformed legacy row
            }
          }
        }
        return sessions;
      },
      save(session: Session) {
        upsert.run(session.roomCode, JSON.stringify(session), session.updatedAt);
      },
      close() {
        db.close();
      },
    };
  } catch {
    // Graceful atomic JSON persistence fallback when running on Node < 22.5
    const jsonFile = path.join(dataDir, 'sessions.json');
    const cache = new Map<string, Session>();

    if (fs.existsSync(jsonFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as Record<string, Session>;
        for (const [code, session] of Object.entries(parsed)) {
          cache.set(code, session);
        }
      } catch {
        // Start clean if file is corrupted
      }
    }

    const flush = () => {
      const tmpFile = `${jsonFile}.tmp`;
      const obj = Object.fromEntries(cache.entries());
      fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(tmpFile, jsonFile);
    };

    return {
      kind: 'json',
      loadAll: () => Array.from(cache.values()),
      save(session: Session) {
        cache.set(session.roomCode, session);
        flush();
      },
      close() {},
    };
  }
}

export class GameError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'GameError';
    this.statusCode = statusCode;
  }
}

export class GameStore {
  private sessions = new Map<string, Session>();
  private adapter: PersistenceAdapter;

  private constructor(adapter: PersistenceAdapter) {
    this.adapter = adapter;
    for (const session of adapter.loadAll()) {
      this.sessions.set(session.roomCode, session);
    }
  }

  static async create(storagePath?: string): Promise<GameStore> {
    const adapter = await createPersistenceAdapter(storagePath);
    return new GameStore(adapter);
  }

  get storageKind(): PersistenceAdapter['kind'] {
    return this.adapter.kind;
  }

  close(): void {
    this.adapter.close();
  }

  private persist(session: Session): void {
    session.updatedAt = new Date().toISOString();
    this.adapter.save(session);
  }

  private recordEvent(session: Session, event: Omit<DecisionEvent, 'id' | 'timestamp'>): DecisionEvent {
    const full: DecisionEvent = {
      ...event,
      id: generateEventId(),
      timestamp: new Date().toISOString(),
    };
    session.events.push(full);
    if (session.events.length > 2000) {
      session.events = session.events.slice(-2000);
    }
    return full;
  }

  createSession(customPasscode?: string): Session {
    let roomCode = generateRoomCode(6);
    while (this.sessions.has(roomCode)) {
      roomCode = generateRoomCode(6);
    }

    const cleanPasscode = customPasscode?.trim();
    const hostSecret = cleanPasscode && cleanPasscode.length >= 4 ? cleanPasscode : generateToken(16);
    const now = new Date().toISOString();

    const session: Session = {
      roomCode,
      hostSecret,
      createdAt: now,
      updatedAt: now,
      activeRoundNumber: null,
      groups: {},
      rounds: [],
      events: [],
    };

    this.sessions.set(roomCode, session);
    this.persist(session);
    return session;
  }

  getSession(rawRoomCode: string): Session | undefined {
    return this.sessions.get(normalizeRoomCode(rawRoomCode));
  }

  requireSession(rawRoomCode: string): Session {
    const session = this.getSession(rawRoomCode);
    if (!session) {
      throw new GameError('Room not found. Double-check the room code.', 404);
    }
    return session;
  }

  verifyHost(rawRoomCode: string, hostSecret: string): Session {
    const session = this.requireSession(rawRoomCode);
    if (!hostSecret || session.hostSecret !== hostSecret) {
      throw new GameError('Invalid instructor key for this room.', 403);
    }
    return session;
  }

  listPublicGroups(rawRoomCode: string): Array<{ id: string; name: string }> {
    const session = this.requireSession(rawRoomCode);
    return Object.values(session.groups)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((g) => ({ id: g.id, name: g.name }));
  }

  createGroup(rawRoomCode: string, rawGroupName: string): { session: Session; group: Group } {
    const session = this.requireSession(rawRoomCode);
    const name = sanitizeGroupName(rawGroupName);
    if (!name) {
      throw new GameError('Please enter a group name.', 400);
    }

    const duplicate = Object.values(session.groups).find(
      (g) => g.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      throw new GameError(
        `A group named "${duplicate.name}" already exists. Select it below and enter its 4-digit Team Code to join your teammates.`,
        409
      );
    }

    const group: Group = {
      id: generateToken(8),
      name,
      teamCode: generateTeamCode(),
      joinToken: generateToken(16),
      createdAt: new Date().toISOString(),
    };

    session.groups[group.id] = group;
    if (session.activeRoundNumber !== null) {
      const round = this.getActiveRound(session);
      if (round && !round.groupStates[group.id]) {
        round.groupStates[group.id] = createEmptyGroupRoundState();
      }
    }

    this.recordEvent(session, {
      roundNumber: session.activeRoundNumber ?? 0,
      groupId: group.id,
      groupName: group.name,
      type: 'joined',
      payload: { note: 'Group created and joined room' },
    });

    this.persist(session);
    return { session, group };
  }

  joinExistingGroup(
    rawRoomCode: string,
    opts: { groupId?: string; teamCode?: string; joinToken?: string }
  ): { session: Session; group: Group } {
    const session = this.requireSession(rawRoomCode);

    if (opts.joinToken) {
      const matched = Object.values(session.groups).find((g) => g.joinToken === opts.joinToken);
      if (matched) {
        return { session, group: matched };
      }
      throw new GameError('Your saved group session is no longer active in this room.', 401);
    }

    if (!opts.groupId) {
      throw new GameError('Please select a group to join.', 400);
    }

    const group = session.groups[opts.groupId];
    if (!group) {
      throw new GameError('Selected group was not found in this room.', 404);
    }

    const cleanCode = (opts.teamCode ?? '').trim();
    if (cleanCode !== group.teamCode) {
      throw new GameError('Incorrect 4-digit Team Code. Ask a teammate or your instructor.', 403);
    }

    return { session, group };
  }

  authenticateGroup(rawRoomCode: string, joinToken: string): { session: Session; group: Group } {
    const session = this.requireSession(rawRoomCode);
    const group = Object.values(session.groups).find((g) => g.joinToken === joinToken);
    if (!group) {
      throw new GameError('Group session expired or removed.', 401);
    }
    return { session, group };
  }

  getActiveRound(session: Session): Round | null {
    if (session.activeRoundNumber === null) return null;
    return session.rounds.find((r) => r.roundNumber === session.activeRoundNumber) ?? null;
  }

  startRound(
    rawRoomCode: string,
    hostSecret: string,
    opts: { secretK: unknown }
  ): { session: Session; round: Round } {
    const session = this.verifyHost(rawRoomCode, hostSecret);
    const validated = validateK(opts.secretK);
    if (!validated.ok) {
      throw new GameError(validated.error, 400);
    }

    const samplingMode: SamplingMode = 'shared';
    const roundNumber = session.rounds.length + 1;
    const groupStates: Record<string, ReturnType<typeof createEmptyGroupRoundState>> = {};
    for (const groupId of Object.keys(session.groups)) {
      groupStates[groupId] = createEmptyGroupRoundState();
    }

    const round: Round = {
      roundNumber,
      secretK: validated.value,
      samplingMode,
      status: 'active',
      sharedSequence: [],
      startedAt: new Date().toISOString(),
      lockedAt: null,
      revealedAt: null,
      groupStates,
    };

    session.rounds.push(round);
    session.activeRoundNumber = roundNumber;

    this.recordEvent(session, {
      roundNumber,
      groupId: null,
      groupName: null,
      type: 'round_started',
      payload: {
        samplingMode,
        note: `Round ${roundNumber} started`,
      },
    });

    this.persist(session);
    return { session, round };
  }

  setRoundStatus(
    rawRoomCode: string,
    hostSecret: string,
    nextStatus: RoundStatus
  ): { session: Session; round: Round } {
    const session = this.verifyHost(rawRoomCode, hostSecret);
    const round = this.getActiveRound(session);
    if (!round) {
      throw new GameError('Start a round first before changing round status.', 400);
    }

    const prevStatus = round.status;
    round.status = nextStatus;

    if (nextStatus === 'locked') {
      round.lockedAt = new Date().toISOString();
      this.recordEvent(session, {
        roundNumber: round.roundNumber,
        groupId: null,
        groupName: null,
        type: prevStatus === 'revealed' ? 'round_hidden' : 'round_locked',
        payload: {
          note: prevStatus === 'revealed' ? 'K hidden again' : 'Submissions locked by instructor',
        },
      });
    } else if (nextStatus === 'revealed') {
      round.revealedAt = new Date().toISOString();
      if (!round.lockedAt) round.lockedAt = round.revealedAt;
      this.recordEvent(session, {
        roundNumber: round.roundNumber,
        groupId: null,
        groupName: null,
        type: 'round_revealed',
        payload: { note: `Actual K revealed (K = ${round.secretK})` },
      });
    } else if (nextStatus === 'active') {
      this.recordEvent(session, {
        roundNumber: round.roundNumber,
        groupId: null,
        groupName: null,
        type: 'unlock',
        payload: { note: 'Round reopened for submissions' },
      });
    }

    this.persist(session);
    return { session, round };
  }

  requestDraws(
    rawRoomCode: string,
    joinToken: string,
    rawCount: unknown
  ): { session: Session; group: Group; round: Round; newDraws: number[] } {
    const { session, group } = this.authenticateGroup(rawRoomCode, joinToken);
    const round = this.getActiveRound(session);
    if (!round) {
      throw new GameError('No active round right now. Wait for your instructor to start a round.', 400);
    }
    if (round.status !== 'active') {
      throw new GameError('This round is locked. No additional numbers can be requested.', 400);
    }

    if (!round.groupStates[group.id]) {
      round.groupStates[group.id] = createEmptyGroupRoundState();
    }
    const state = round.groupStates[group.id];
    if (state.guess !== null) {
      throw new GameError('Your group has already locked in a guess for this round.', 400);
    }

    const validated = validateDrawCount(rawCount, state.draws.length);
    if (!validated.ok) {
      throw new GameError(validated.error, 400);
    }

    const newDraws = drawNumbersForGroup(round, state, validated.value);
    const stats = computeSampleStats(state.draws);

    this.recordEvent(session, {
      roundNumber: round.roundNumber,
      groupId: group.id,
      groupName: group.name,
      type: 'draw',
      payload: {
        requested: validated.value,
        totalAfter: stats.count,
        drawnValues: newDraws,
        minAfter: stats.min ?? undefined,
        maxAfter: stats.max ?? undefined,
      },
    });

    this.persist(session);
    return { session, group, round, newDraws };
  }

  submitGuess(
    rawRoomCode: string,
    joinToken: string,
    rawGuess: unknown
  ): { session: Session; group: Group; round: Round } {
    const { session, group } = this.authenticateGroup(rawRoomCode, joinToken);
    const round = this.getActiveRound(session);
    if (!round) {
      throw new GameError('No active round right now.', 400);
    }
    if (round.status !== 'active') {
      throw new GameError('This round is no longer accepting guesses.', 400);
    }

    if (!round.groupStates[group.id]) {
      round.groupStates[group.id] = createEmptyGroupRoundState();
    }
    const state = round.groupStates[group.id];
    if (state.guess !== null) {
      throw new GameError('Your group has already submitted its one guess for this round.', 400);
    }
    if (state.draws.length < 1) {
      throw new GameError('Request at least 1 number before submitting your guess.', 400);
    }

    const validated = validateGuess(rawGuess);
    if (!validated.ok) {
      throw new GameError(validated.error, 400);
    }

    const { absError, score } = calculateScore(state.draws.length, validated.value, round.secretK);
    state.guess = validated.value;
    state.submittedAt = new Date().toISOString();
    state.absError = absError;
    state.score = score;

    const stats = computeSampleStats(state.draws);
    this.recordEvent(session, {
      roundNumber: round.roundNumber,
      groupId: group.id,
      groupName: group.name,
      type: 'submit',
      payload: {
        totalAfter: stats.count,
        minAfter: stats.min ?? undefined,
        maxAfter: stats.max ?? undefined,
        guess: validated.value,
      },
    });

    this.persist(session);
    return { session, group, round };
  }

  unlockGroupGuess(
    rawRoomCode: string,
    hostSecret: string,
    groupId: string
  ): { session: Session; group: Group; round: Round } {
    const session = this.verifyHost(rawRoomCode, hostSecret);
    const group = session.groups[groupId];
    if (!group) {
      throw new GameError('Group not found.', 404);
    }
    const round = this.getActiveRound(session);
    if (!round) {
      throw new GameError('No active round.', 400);
    }
    if (round.status === 'revealed') {
      throw new GameError('Cannot unlock a guess after K has already been revealed.', 400);
    }

    const state = round.groupStates[groupId];
    if (state) {
      state.guess = null;
      state.submittedAt = null;
      state.absError = null;
      state.score = null;
    }

    this.recordEvent(session, {
      roundNumber: round.roundNumber,
      groupId: group.id,
      groupName: group.name,
      type: 'unlock',
      payload: {
        totalAfter: state?.draws.length ?? 0,
        note: 'Guess unlocked by instructor',
      },
    });

    this.persist(session);
    return { session, group, round };
  }

  removeGroup(rawRoomCode: string, hostSecret: string, groupId: string): { session: Session; removedName: string } {
    const session = this.verifyHost(rawRoomCode, hostSecret);
    const group = session.groups[groupId];
    if (!group) {
      throw new GameError('Group not found.', 404);
    }
    const removedName = group.name;
    delete session.groups[groupId];
    for (const round of session.rounds) {
      delete round.groupStates[groupId];
    }
    this.persist(session);
    return { session, removedName };
  }
}
