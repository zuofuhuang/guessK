(function () {
  const STORAGE_KEYS = {
    masterSessions: 'guessk_master_sessions_v1',
    studentSessions: 'guessk_student_sessions_v1',
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeRoomInput(raw) {
    const text = String(raw || '').trim();
    // Allow pasting full URL like https://.../play/K7M4P2
    const urlMatch = text.match(/\/(?:play|master)\/([A-Za-z0-9]+)/i);
    const candidate = urlMatch ? urlMatch[1] : text;
    return candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatScore(score) {
    if (score === null || score === undefined || Number.isNaN(Number(score))) return '—';
    return Number(score).toFixed(2);
  }

  function formatNum(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return Number(value).toLocaleString();
  }

  function showToast(message, variant = 'default', durationMs = 3400) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast${variant === 'error' ? ' toast-error' : variant === 'success' ? ' toast-success' : ''}`;
    el.textContent = message;
    container.appendChild(el);
    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 180ms ease';
      window.setTimeout(() => el.remove(), 200);
    }, durationMs);
  }

  async function copyText(text, successMsg = 'Copied to clipboard') {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(successMsg, 'success');
        return true;
      }
    } catch {
      // Fall through to legacy textarea copy
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(successMsg, 'success');
      return true;
    } catch {
      showToast('Could not copy automatically. Please copy manually.', 'error');
      return false;
    }
  }

  function readJsonStorage(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota / private mode failures
    }
  }

  function saveMasterSession(roomCode, hostSecret) {
    const list = readJsonStorage(STORAGE_KEYS.masterSessions, []);
    const filtered = list.filter((item) => item.roomCode !== roomCode);
    filtered.unshift({ roomCode, hostSecret, savedAt: new Date().toISOString() });
    writeJsonStorage(STORAGE_KEYS.masterSessions, filtered.slice(0, 10));
  }

  function getMasterSessions() {
    return readJsonStorage(STORAGE_KEYS.masterSessions, []);
  }

  function getMasterKey(roomCode) {
    const found = getMasterSessions().find((item) => item.roomCode === roomCode);
    return found ? found.hostSecret : '';
  }

  function saveStudentSession(roomCode, group) {
    const map = readJsonStorage(STORAGE_KEYS.studentSessions, {});
    map[roomCode] = {
      roomCode,
      groupId: group.id,
      groupName: group.name,
      teamCode: group.teamCode,
      joinToken: group.joinToken,
      savedAt: new Date().toISOString(),
    };
    writeJsonStorage(STORAGE_KEYS.studentSessions, map);
  }

  function getStudentSession(roomCode) {
    const map = readJsonStorage(STORAGE_KEYS.studentSessions, {});
    return map[roomCode] || null;
  }

  function getAllStudentSessions() {
    const map = readJsonStorage(STORAGE_KEYS.studentSessions, {});
    return Object.values(map).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  function clearStudentSession(roomCode) {
    const map = readJsonStorage(STORAGE_KEYS.studentSessions, {});
    delete map[roomCode];
    writeJsonStorage(STORAGE_KEYS.studentSessions, map);
  }

  async function apiJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function getRoomCodeFromPath(prefix) {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === prefix && parts[1]) {
      return normalizeRoomInput(decodeURIComponent(parts[1]));
    }
    return '';
  }

  window.GuessK = {
    escapeHtml,
    normalizeRoomInput,
    formatTime,
    formatScore,
    formatNum,
    showToast,
    copyText,
    saveMasterSession,
    getMasterSessions,
    getMasterKey,
    saveStudentSession,
    getStudentSession,
    getAllStudentSessions,
    clearStudentSession,
    apiJson,
    getRoomCodeFromPath,
  };
})();
