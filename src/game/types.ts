export type SamplingMode = 'independent' | 'shared';

export type RoundStatus = 'active' | 'locked' | 'revealed';

export type DecisionEventType = 'joined' | 'draw' | 'submit' | 'unlock' | 'round_started' | 'round_locked' | 'round_revealed' | 'round_hidden';

export interface DecisionEvent {
  id: string;
  roundNumber: number;
  groupId: string | null;
  groupName: string | null;
  type: DecisionEventType;
  timestamp: string;
  payload: {
    requested?: number;
    totalAfter?: number;
    drawnValues?: number[];
    minAfter?: number;
    maxAfter?: number;
    guess?: number;
    samplingMode?: SamplingMode;
    note?: string;
  };
}

export interface GroupRoundState {
  draws: number[];
  requestHistory: number[];
  guess: number | null;
  submittedAt: string | null;
  absError: number | null;
  score: number | null;
}

export interface Round {
  roundNumber: number;
  secretK: number;
  samplingMode: SamplingMode;
  status: RoundStatus;
  sharedSequence: number[];
  startedAt: string;
  lockedAt: string | null;
  revealedAt: string | null;
  groupStates: Record<string, GroupRoundState>;
}

export interface Group {
  id: string;
  name: string;
  teamCode: string;
  joinToken: string;
  createdAt: string;
}

export interface Session {
  roomCode: string;
  hostSecret: string;
  createdAt: string;
  updatedAt: string;
  activeRoundNumber: number | null;
  groups: Record<string, Group>;
  rounds: Round[];
  events: DecisionEvent[];
}

export interface RevealedLeaderboardEntry {
  rank: number | null;
  groupId: string;
  groupName: string;
  requestedCount: number;
  min: number | null;
  max: number | null;
  guess: number | null;
  absError: number | null;
  score: number | null;
  submitted: boolean;
}

export interface StudentView {
  roomCode: string;
  group: {
    id: string;
    name: string;
    teamCode: string;
    connectedDevices: number;
  };
  round: {
    roundNumber: number;
    samplingMode: SamplingMode;
    status: RoundStatus;
    draws: number[];
    sortedDraws: number[];
    requestHistory: number[];
    count: number;
    min: number | null;
    max: number | null;
    guess: number | null;
    submittedAt: string | null;
    secretK: number | null;
    absError: number | null;
    score: number | null;
    rank: number | null;
    totalGroups: number;
    submittedCount: number;
    leaderboard: RevealedLeaderboardEntry[] | null;
  } | null;
  pastRounds: Array<{
    roundNumber: number;
    status: RoundStatus;
    secretK: number | null;
    requestedCount: number;
    guess: number | null;
    absError: number | null;
    score: number | null;
  }>;
}

export interface MasterGroupRow {
  groupId: string;
  groupName: string;
  teamCode: string;
  connectedDevices: number;
  online: boolean;
  status: 'waiting' | 'sampling' | 'submitted';
  requestedCount: number;
  requestHistory: number[];
  draws: number[];
  sortedDraws: number[];
  min: number | null;
  max: number | null;
  mean: number | null;
  momEstimate: number | null;
  maxAdjustedEstimate: number | null;
  guess: number | null;
  submittedAt: string | null;
  absError: number | null;
  score: number | null;
  rank: number | null;
}

export interface CumulativeGroupRow {
  groupId: string;
  groupName: string;
  roundsPlayed: number;
  totalRequested: number;
  totalScore: number;
  perRound: Record<number, { requestedCount: number; guess: number | null; score: number | null }>;
}

export interface MasterRoundView {
  roundNumber: number;
  secretK: number;
  samplingMode: SamplingMode;
  status: RoundStatus;
  startedAt: string;
  lockedAt: string | null;
  revealedAt: string | null;
  groups: MasterGroupRow[];
  summary: {
    totalGroups: number;
    onlineGroups: number;
    submittedGroups: number;
    avgRequested: number | null;
    avgGuess: number | null;
    avgError: number | null;
    topScore: number | null;
    topScorerNames: string[];
  };
}

export interface MasterView {
  roomCode: string;
  createdAt: string;
  activeRoundNumber: number | null;
  groups: Array<{
    id: string;
    name: string;
    teamCode: string;
    connectedDevices: number;
    online: boolean;
    createdAt: string;
  }>;
  rounds: MasterRoundView[];
  cumulative: CumulativeGroupRow[];
  events: DecisionEvent[];
}
