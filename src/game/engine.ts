import crypto from 'node:crypto';
import type {
  CumulativeGroupRow,
  GroupRoundState,
  MasterGroupRow,
  MasterRoundView,
  MasterView,
  RevealedLeaderboardEntry,
  Round,
  Session,
  StudentView,
} from './types.js';

export const MIN_K = 2;
export const MAX_K = 1_000_000_000;
export const MAX_SINGLE_DRAW = 100;
export const MAX_TOTAL_DRAWS_PER_ROUND = 2_000;
export const MAX_GROUP_NAME_LENGTH = 36;

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

export function generateTeamCode(): string {
  return String(crypto.randomInt(1000, 10000));
}

export function generateToken(byteLength = 24): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function generateEventId(): string {
  return crypto.randomUUID();
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sanitizeGroupName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME_LENGTH);
}

export function validateK(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < MIN_K || parsed > MAX_K) {
    return {
      ok: false,
      error: `Please enter a whole number K between ${MIN_K} and ${MAX_K.toLocaleString()}.`,
    };
  }
  return { ok: true, value: parsed };
}

export function validateDrawCount(
  value: unknown,
  currentTotal: number
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SINGLE_DRAW) {
    return {
      ok: false,
      error: `You can request between 1 and ${MAX_SINGLE_DRAW} numbers at a time.`,
    };
  }
  if (currentTotal + parsed > MAX_TOTAL_DRAWS_PER_ROUND) {
    return {
      ok: false,
      error: `Maximum ${MAX_TOTAL_DRAWS_PER_ROUND.toLocaleString()} draws allowed per round.`,
    };
  }
  return { ok: true, value: parsed };
}

export function validateGuess(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_K) {
    return {
      ok: false,
      error: `Please enter a whole number guess between 1 and ${MAX_K.toLocaleString()}.`,
    };
  }
  return { ok: true, value: parsed };
}

export function randomIntFrom1To(secretK: number): number {
  return crypto.randomInt(1, secretK + 1);
}

export function createEmptyGroupRoundState(): GroupRoundState {
  return {
    draws: [],
    requestHistory: [],
    guess: null,
    submittedAt: null,
    absError: null,
    score: null,
  };
}

export function calculateScore(requestedCount: number, guess: number, secretK: number): { absError: number; score: number } {
  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    throw new Error('At least 1 number must be requested before calculating a score.');
  }
  const absError = Math.abs(guess - secretK);
  const denominator = requestedCount + absError;
  const score = 100 / denominator;
  return { absError, score };
}

export function computeSampleStats(draws: number[]): {
  count: number;
  sortedDraws: number[];
  min: number | null;
  max: number | null;
  mean: number | null;
  momEstimate: number | null;
  maxAdjustedEstimate: number | null;
} {
  const count = draws.length;
  if (count === 0) {
    return {
      count: 0,
      sortedDraws: [],
      min: null,
      max: null,
      mean: null,
      momEstimate: null,
      maxAdjustedEstimate: null,
    };
  }

  const sortedDraws = [...draws].sort((a, b) => a - b);
  const min = sortedDraws[0];
  const max = sortedDraws[count - 1];
  const sum = sortedDraws.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;
  const momEstimate = 2 * mean - 1;
  const maxAdjustedEstimate = ((count + 1) / count) * max;

  return {
    count,
    sortedDraws,
    min,
    max,
    mean,
    momEstimate,
    maxAdjustedEstimate,
  };
}

export function drawNumbersForGroup(round: Round, groupState: GroupRoundState, count: number): number[] {
  const newDraws: number[] = [];

  if (round.samplingMode === 'shared') {
    const startIdx = groupState.draws.length;
    const neededLength = startIdx + count;
    while (round.sharedSequence.length < neededLength) {
      round.sharedSequence.push(randomIntFrom1To(round.secretK));
    }
    for (let i = startIdx; i < neededLength; i += 1) {
      newDraws.push(round.sharedSequence[i]);
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      newDraws.push(randomIntFrom1To(round.secretK));
    }
  }

  groupState.draws.push(...newDraws);
  groupState.requestHistory.push(count);
  return newDraws;
}

function assignRanks<T extends { score: number | null; absError: number | null; requestedCount: number; rank: number | null }>(
  rows: T[]
): void {
  const scored = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => {
      if ((b.score ?? -1) !== (a.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1);
      if ((a.absError ?? Infinity) !== (b.absError ?? Infinity)) return (a.absError ?? Infinity) - (b.absError ?? Infinity);
      return a.requestedCount - b.requestedCount;
    });

  let currentRank = 0;
  let prevScore: number | null = null;
  scored.forEach((row, idx) => {
    const roundedScore = row.score !== null ? Number(row.score.toFixed(6)) : null;
    if (prevScore === null || roundedScore !== prevScore) {
      currentRank = idx + 1;
      prevScore = roundedScore;
    }
    row.rank = currentRank;
  });
}

function buildRevealedLeaderboard(session: Session, round: Round): RevealedLeaderboardEntry[] {
  const entries: RevealedLeaderboardEntry[] = Object.values(session.groups).map((group) => {
    const state = round.groupStates[group.id] ?? createEmptyGroupRoundState();
    const stats = computeSampleStats(state.draws);
    return {
      rank: null,
      groupId: group.id,
      groupName: group.name,
      requestedCount: stats.count,
      min: stats.min,
      max: stats.max,
      guess: state.guess,
      absError: state.absError,
      score: state.score,
      submitted: state.guess !== null,
    };
  });

  assignRanks(entries);
  entries.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.groupName.localeCompare(b.groupName);
  });
  return entries;
}

export function buildStudentView(
  session: Session,
  groupId: string,
  connectionCounts: Map<string, number>
): StudentView | null {
  const group = session.groups[groupId];
  if (!group) return null;

  const activeRound =
    session.activeRoundNumber !== null
      ? session.rounds.find((r) => r.roundNumber === session.activeRoundNumber) ?? null
      : null;

  let roundView: StudentView['round'] = null;
  if (activeRound) {
    const state = activeRound.groupStates[groupId] ?? createEmptyGroupRoundState();
    const stats = computeSampleStats(state.draws);
    const isRevealed = activeRound.status === 'revealed';
    const totalGroups = Object.keys(session.groups).length;
    const submittedCount = Object.values(session.groups).filter(
      (g) => (activeRound.groupStates[g.id]?.guess ?? null) !== null
    ).length;

    const leaderboard = isRevealed ? buildRevealedLeaderboard(session, activeRound) : null;
    const ownEntry = leaderboard ? leaderboard.find((e) => e.groupId === groupId) ?? null : null;

    roundView = {
      roundNumber: activeRound.roundNumber,
      samplingMode: activeRound.samplingMode,
      status: activeRound.status,
      draws: state.draws,
      sortedDraws: stats.sortedDraws,
      requestHistory: state.requestHistory,
      count: stats.count,
      min: stats.min,
      max: stats.max,
      guess: state.guess,
      submittedAt: state.submittedAt,
      // STRICT SECRET ISOLATION: Never expose K, error, or score until instructor reveals the round.
      secretK: isRevealed ? activeRound.secretK : null,
      absError: isRevealed ? state.absError : null,
      score: isRevealed ? state.score : null,
      rank: isRevealed ? (ownEntry?.rank ?? null) : null,
      totalGroups,
      submittedCount,
      leaderboard,
    };
  }

  const pastRounds = session.rounds
    .filter((r) => r.roundNumber !== session.activeRoundNumber)
    .map((r) => {
      const state = r.groupStates[groupId] ?? createEmptyGroupRoundState();
      const isRevealed = r.status === 'revealed';
      return {
        roundNumber: r.roundNumber,
        status: r.status,
        secretK: isRevealed ? r.secretK : null,
        requestedCount: state.draws.length,
        guess: state.guess,
        absError: isRevealed ? state.absError : null,
        score: isRevealed ? state.score : null,
      };
    });

  return {
    roomCode: session.roomCode,
    group: {
      id: group.id,
      name: group.name,
      teamCode: group.teamCode,
      connectedDevices: connectionCounts.get(group.id) ?? 0,
    },
    round: roundView,
    pastRounds,
  };
}

export function buildMasterView(session: Session, connectionCounts: Map<string, number>): MasterView {
  const allGroups = Object.values(session.groups).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const rounds: MasterRoundView[] = session.rounds.map((round) => {
    const groupRows: MasterGroupRow[] = allGroups.map((group) => {
      const state = round.groupStates[group.id] ?? createEmptyGroupRoundState();
      const stats = computeSampleStats(state.draws);
      const connectedDevices = connectionCounts.get(group.id) ?? 0;

      let status: MasterGroupRow['status'] = 'waiting';
      if (state.guess !== null) {
        status = 'submitted';
      } else if (stats.count > 0) {
        status = 'sampling';
      }

      return {
        groupId: group.id,
        groupName: group.name,
        teamCode: group.teamCode,
        connectedDevices,
        online: connectedDevices > 0,
        status,
        requestedCount: stats.count,
        requestHistory: state.requestHistory,
        draws: state.draws,
        sortedDraws: stats.sortedDraws,
        min: stats.min,
        max: stats.max,
        mean: stats.mean,
        momEstimate: stats.momEstimate,
        maxAdjustedEstimate: stats.maxAdjustedEstimate,
        guess: state.guess,
        submittedAt: state.submittedAt,
        absError: state.absError,
        score: state.score,
        rank: null,
      };
    });

    assignRanks(groupRows);

    const submittedRows = groupRows.filter((g) => g.guess !== null);
    const activeSamplerRows = groupRows.filter((g) => g.requestedCount > 0 || g.guess !== null);
    const avgRequested =
      activeSamplerRows.length > 0
        ? activeSamplerRows.reduce((acc, g) => acc + g.requestedCount, 0) / activeSamplerRows.length
        : null;
    const avgGuess =
      submittedRows.length > 0
        ? submittedRows.reduce((acc, g) => acc + (g.guess ?? 0), 0) / submittedRows.length
        : null;
    const avgError =
      submittedRows.length > 0
        ? submittedRows.reduce((acc, g) => acc + (g.absError ?? 0), 0) / submittedRows.length
        : null;

    const topRankRows = groupRows.filter((g) => g.rank === 1 && g.score !== null);
    const topScore = topRankRows.length > 0 ? topRankRows[0].score : null;
    const topScorerNames = topRankRows.map((g) => g.groupName);

    return {
      roundNumber: round.roundNumber,
      secretK: round.secretK,
      samplingMode: round.samplingMode,
      status: round.status,
      startedAt: round.startedAt,
      lockedAt: round.lockedAt,
      revealedAt: round.revealedAt,
      groups: groupRows,
      summary: {
        totalGroups: groupRows.length,
        onlineGroups: groupRows.filter((g) => g.online).length,
        submittedGroups: submittedRows.length,
        avgRequested,
        avgGuess,
        avgError,
        topScore,
        topScorerNames,
      },
    };
  });

  const cumulative: CumulativeGroupRow[] = allGroups
    .map((group) => {
      const perRound: CumulativeGroupRow['perRound'] = {};
      let roundsPlayed = 0;
      let totalRequested = 0;
      let totalScore = 0;

      for (const round of session.rounds) {
        const state = round.groupStates[group.id];
        const requestedCount = state ? state.draws.length : 0;
        const guess = state ? state.guess : null;
        const score = state ? state.score : null;
        perRound[round.roundNumber] = { requestedCount, guess, score };
        if (guess !== null && score !== null) {
          roundsPlayed += 1;
          totalScore += score;
        }
        totalRequested += requestedCount;
      }

      return {
        groupId: group.id,
        groupName: group.name,
        roundsPlayed,
        totalRequested,
        totalScore,
        perRound,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.groupName.localeCompare(b.groupName));

  return {
    roomCode: session.roomCode,
    createdAt: session.createdAt,
    activeRoundNumber: session.activeRoundNumber,
    groups: allGroups.map((g) => ({
      id: g.id,
      name: g.name,
      teamCode: g.teamCode,
      connectedDevices: connectionCounts.get(g.id) ?? 0,
      online: (connectionCounts.get(g.id) ?? 0) > 0,
      createdAt: g.createdAt,
    })),
    rounds,
    cumulative,
    events: session.events.slice(-250),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Mitigate spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildRoundSummaryCsv(session: Session, roundNumber?: number): string {
  const targetRounds =
    typeof roundNumber === 'number'
      ? session.rounds.filter((r) => r.roundNumber === roundNumber)
      : session.rounds;

  const headers = [
    'Room Code',
    'Round',
    'Sampling Mode',
    'Round Status',
    'Actual K',
    'Group Name',
    'Numbers Requested',
    'Request Steps',
    'Sample Min',
    'Sample Max',
    'Sample Mean',
    'Guessed K',
    'Absolute Error',
    'Score',
    'Submitted At',
    'Sorted Sample',
  ];

  const lines = [headers.map(csvCell).join(',')];
  const groups = Object.values(session.groups).sort((a, b) => a.name.localeCompare(b.name));

  for (const round of targetRounds) {
    for (const group of groups) {
      const state = round.groupStates[group.id] ?? createEmptyGroupRoundState();
      const stats = computeSampleStats(state.draws);
      lines.push(
        [
          session.roomCode,
          round.roundNumber,
          round.samplingMode,
          round.status,
          round.secretK,
          group.name,
          stats.count,
          state.requestHistory.map((n) => `+${n}`).join(' '),
          stats.min ?? '',
          stats.max ?? '',
          stats.mean !== null ? stats.mean.toFixed(2) : '',
          state.guess ?? '',
          state.absError ?? '',
          state.score !== null ? state.score.toFixed(4) : '',
          state.submittedAt ?? '',
          stats.sortedDraws.join(' '),
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

export function buildDecisionLogCsv(session: Session, roundNumber?: number): string {
  const targetEvents =
    typeof roundNumber === 'number'
      ? session.events.filter((e) => e.roundNumber === roundNumber)
      : session.events;

  const headers = [
    'Timestamp',
    'Room Code',
    'Round',
    'Group Name',
    'Event Type',
    'Requested Count',
    'Total Draws After',
    'Min After',
    'Max After',
    'Guessed K',
    'Drawn Values',
    'Note',
  ];

  const lines = [headers.map(csvCell).join(',')];

  for (const ev of targetEvents) {
    lines.push(
      [
        ev.timestamp,
        session.roomCode,
        ev.roundNumber,
        ev.groupName ?? '',
        ev.type,
        ev.payload.requested ?? '',
        ev.payload.totalAfter ?? '',
        ev.payload.minAfter ?? '',
        ev.payload.maxAfter ?? '',
        ev.payload.guess ?? '',
        ev.payload.drawnValues ? ev.payload.drawnValues.join(' ') : '',
        ev.payload.note ?? '',
      ]
        .map(csvCell)
        .join(',')
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}
