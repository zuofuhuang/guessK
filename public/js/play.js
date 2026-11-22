(function () {
  const {
    createSocket,
    escapeHtml,
    formatScore,
    formatNum,
    showToast,
    saveStudentSession,
    getStudentSession,
    clearStudentSession,
    apiJson,
    getRoomCodeFromPath,
  } = window.GuessK;

  const roomCode = getRoomCodeFromPath('play');

  // Topbar elements
  const topbarRoomCode = document.getElementById('topbar-room-code');
  const topbarGroupBadge = document.getElementById('topbar-group-badge');
  const topbarTeamCode = document.getElementById('topbar-team-code');
  const topbarRoundBadge = document.getElementById('topbar-round-badge');
  const connectionDot = document.getElementById('connection-dot');
  const connectionLabel = document.getElementById('connection-label');
  const switchGroupBtn = document.getElementById('switch-group-btn');

  // Views
  const roomErrorView = document.getElementById('room-error-view');
  const roomErrorText = document.getElementById('room-error-text');
  const groupJoinView = document.getElementById('group-join-view');
  const playView = document.getElementById('play-view');

  // Join view elements
  const joinHeadingCode = document.getElementById('join-heading-code');
  const createGroupForm = document.getElementById('create-group-form');
  const newGroupNameInput = document.getElementById('new-group-name');
  const createGroupBtn = document.getElementById('create-group-btn');
  const createGroupError = document.getElementById('create-group-error');
  const existingGroupsEmpty = document.getElementById('existing-groups-empty');
  const existingGroupsList = document.getElementById('existing-groups-list');
  const joinExistingForm = document.getElementById('join-existing-form');
  const existingTeamCodeInput = document.getElementById('existing-team-code');
  const selectedGroupLabel = document.getElementById('selected-group-label');
  const joinExistingBtn = document.getElementById('join-existing-btn');
  const joinExistingError = document.getElementById('join-existing-error');

  // Play view elements
  const rulesDetails = document.getElementById('rules-details');
  const lobbyWaitingCard = document.getElementById('lobby-waiting-card');
  const lobbyGroupHeading = document.getElementById('lobby-group-heading');
  const lobbyRoomInline = document.getElementById('lobby-room-inline');
  const lobbyPinInline = document.getElementById('lobby-pin-inline');
  const roundWorkspace = document.getElementById('round-workspace');
  const roundEyebrow = document.getElementById('round-eyebrow');
  const roundHeading = document.getElementById('round-heading');
  const roundProgressBadge = document.getElementById('round-progress-badge');
  const devicesBadge = document.getElementById('devices-badge');
  const studentStatusBanner = document.getElementById('student-status-banner');

  const drawButtons = Array.from(document.querySelectorAll('.draw-btn'));
  const customDrawForm = document.getElementById('custom-draw-form');
  const customDrawInput = document.getElementById('custom-draw-input');
  const customDrawBtn = document.getElementById('custom-draw-btn');

  const guessFormWrap = document.getElementById('guess-form-wrap');
  const guessForm = document.getElementById('guess-form');
  const guessInput = document.getElementById('guess-input');
  const submitGuessBtn = document.getElementById('submit-guess-btn');
  const guessHelperText = document.getElementById('guess-helper-text');
  const guessLockedWrap = document.getElementById('guess-locked-wrap');
  const lockedGuessValue = document.getElementById('locked-guess-value');
  const lockedGuessMeta = document.getElementById('locked-guess-meta');

  const statCount = document.getElementById('stat-count');
  const statMin = document.getElementById('stat-min');
  const statMax = document.getElementById('stat-max');
  const statStatus = document.getElementById('stat-status');
  const sampleNumbers = document.getElementById('sample-numbers');
  const sampleEmpty = document.getElementById('sample-empty');
  const requestHistoryLine = document.getElementById('request-history-line');

  const revealCard = document.getElementById('reveal-card');
  const revealKValue = document.getElementById('reveal-k-value');
  const revealRankBadge = document.getElementById('reveal-rank-badge');
  const revealScoreBreakdown = document.getElementById('reveal-score-breakdown');
  const studentLeaderboardSection = document.getElementById('student-leaderboard-section');
  const studentLbRound = document.getElementById('student-lb-round');
  const studentLbBody = document.getElementById('student-lb-body');
  const pastRoundsSection = document.getElementById('past-rounds-section');
  const pastRoundsBody = document.getElementById('past-rounds-body');

  // Confirmation modal
  const confirmModal = document.getElementById('confirm-guess-modal');
  const confirmCloseBtn = document.getElementById('confirm-close-btn');
  const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
  const confirmSubmitBtn = document.getElementById('confirm-submit-btn');
  const confirmRequestedVal = document.getElementById('confirm-requested-val');
  const confirmGuessVal = document.getElementById('confirm-guess-val');
  const confirmWarningBox = document.getElementById('confirm-warning-box');

  // Client state
  let socket = null;
  let currentGroupAuth = null; // { id, name, teamCode, joinToken }
  let currentState = null;
  let selectedExistingGroup = null;
  let pendingGuessValue = null;
  let pendingDrawLock = false;
  let prevRoundNumber = null;
  let prevDrawCount = 0;
  let highlightValues = [];

  function setError(el, msg) {
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
    } else {
      el.hidden = false;
      el.textContent = msg;
    }
  }

  function setConnectionStatus(connected, text) {
    connectionDot.className = `dot ${connected ? 'online' : 'offline'}`;
    connectionLabel.textContent = text;
  }

  function showOnlyView(viewName) {
    roomErrorView.hidden = viewName !== 'error';
    groupJoinView.hidden = viewName !== 'join';
    playView.hidden = viewName !== 'play';
  }

  function renderExistingGroups(groups) {
    if (!groups || groups.length === 0) {
      existingGroupsEmpty.hidden = false;
      existingGroupsList.hidden = true;
      joinExistingForm.hidden = true;
      selectedExistingGroup = null;
      return;
    }

    existingGroupsEmpty.hidden = true;
    existingGroupsList.hidden = false;
    existingGroupsList.innerHTML = '';

    groups.forEach((g) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `group-choice${selectedExistingGroup?.id === g.id ? ' selected' : ''}`;
      btn.innerHTML = `<span>${escapeHtml(g.name)}</span><span class="small" style="margin:0;">Select</span>`;
      btn.addEventListener('click', () => {
        selectedExistingGroup = g;
        selectedGroupLabel.textContent = g.name;
        joinExistingForm.hidden = false;
        setError(joinExistingError, '');
        existingTeamCodeInput.value = '';
        existingTeamCodeInput.focus();
        renderExistingGroups(groups);
      });
      existingGroupsList.appendChild(btn);
    });
  }

  async function loadRoomAndInit() {
    if (!roomCode) {
      roomErrorText.textContent = 'No room code was provided in the URL.';
      showOnlyView('error');
      setConnectionStatus(false, 'No room');
      return;
    }

    topbarRoomCode.textContent = `ROOM ${roomCode}`;
    joinHeadingCode.textContent = roomCode;
    document.title = `Room ${roomCode} — Guess the Hidden K`;

    let roomInfo;
    try {
      roomInfo = await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}`);
    } catch (err) {
      roomErrorText.textContent = err.message || 'This classroom room does not exist.';
      showOnlyView('error');
      setConnectionStatus(false, 'Not found');
      return;
    }

    // Attempt seamless auto-rejoin from saved localStorage token
    const saved = getStudentSession(roomCode);
    if (saved && saved.joinToken) {
      try {
        const rejoined = await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}/groups/join`, {
          method: 'POST',
          body: JSON.stringify({ joinToken: saved.joinToken }),
        });
        enterGroupPlay(rejoined.group);
        return;
      } catch {
        clearStudentSession(roomCode);
      }
    }

    renderExistingGroups(roomInfo.groups);
    showOnlyView('join');
    setConnectionStatus(true, 'Room ready');
  }

  function enterGroupPlay(group) {
    currentGroupAuth = group;
    saveStudentSession(roomCode, group);

    topbarGroupBadge.textContent = group.name;
    topbarGroupBadge.hidden = false;
    topbarTeamCode.textContent = `Team PIN: ${group.teamCode}`;
    topbarTeamCode.hidden = false;
    switchGroupBtn.hidden = false;

    lobbyGroupHeading.textContent = group.name;
    lobbyRoomInline.textContent = roomCode;
    lobbyPinInline.textContent = group.teamCode;

    showOnlyView('play');
    connectSocket();
  }

  function connectSocket() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    setConnectionStatus(false, 'Connecting…');
    socket = createSocket();

    socket.on('connect', () => {
      setConnectionStatus(true, 'Live');
      if (!currentGroupAuth) return;
      socket.emit(
        'student:auth',
        { roomCode, joinToken: currentGroupAuth.joinToken },
        (res) => {
          if (!res || !res.ok) {
            showToast(res?.error || 'Could not reconnect to group.', 'error');
            clearStudentSession(roomCode);
            currentGroupAuth = null;
            loadRoomAndInit();
            return;
          }
          if (res.state) {
            applyStudentState(res.state);
          }
        }
      );
    });

    socket.on('disconnect', () => {
      setConnectionStatus(false, 'Reconnecting…');
    });

    socket.on('student:state', (state) => {
      applyStudentState(state);
    });

    socket.on('student:notice', (payload) => {
      if (payload?.message) {
        showToast(payload.message, 'success', 4800);
      }
    });

    socket.on('student:removed', (payload) => {
      showToast(payload?.message || 'Your group was removed by the instructor.', 'error', 5000);
      clearStudentSession(roomCode);
      currentGroupAuth = null;
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      topbarGroupBadge.hidden = true;
      topbarTeamCode.hidden = true;
      topbarRoundBadge.hidden = true;
      switchGroupBtn.hidden = true;
      loadRoomAndInit();
    });
  }

  function applyStudentState(state) {
    currentState = state;

    topbarGroupBadge.textContent = state.group.name;
    topbarTeamCode.textContent = `Team PIN: ${state.group.teamCode}`;

    if (state.group.connectedDevices > 1) {
      devicesBadge.hidden = false;
      devicesBadge.textContent = `${state.group.connectedDevices} devices synced`;
    } else {
      devicesBadge.hidden = true;
    }

    const round = state.round;
    if (!round) {
      topbarRoundBadge.hidden = false;
      topbarRoundBadge.textContent = 'Lobby';
      lobbyWaitingCard.hidden = false;
      roundWorkspace.hidden = true;
      prevRoundNumber = null;
      prevDrawCount = 0;
      highlightValues = [];
      return;
    }

    // Detect round switch or incremental draws (skip highlighting on initial page load)
    if (prevRoundNumber === null) {
      highlightValues = [];
    } else if (prevRoundNumber !== round.roundNumber) {
      guessInput.value = '';
      highlightValues = [];
      prevDrawCount = 0;
      showToast(`Round ${round.roundNumber} has started!`, 'success');
    } else if (round.count > prevDrawCount) {
      // Newly added draws (could come from this device OR a teammate's device)
      highlightValues = round.draws.slice(prevDrawCount);
    } else {
      highlightValues = [];
    }

    prevRoundNumber = round.roundNumber;
    prevDrawCount = round.count;

    lobbyWaitingCard.hidden = true;
    roundWorkspace.hidden = false;

    const statusLabels = {
      active: 'Open',
      locked: 'Locked',
      revealed: 'Revealed',
    };
    topbarRoundBadge.hidden = false;
    topbarRoundBadge.textContent = `Round ${round.roundNumber} · ${statusLabels[round.status] || round.status}`;

    roundEyebrow.textContent =
      round.samplingMode === 'shared'
        ? `Round ${round.roundNumber} · Shared Sample Stream`
        : `Round ${round.roundNumber} · Independent Draws`;
    roundHeading.textContent = state.group.name;
    roundProgressBadge.textContent = `${round.submittedCount} / ${round.totalGroups} groups submitted`;

    // Collapse rules once they start drawing so mobile users have maximum space
    if (round.count > 0 && rulesDetails.dataset.autoCollapsed !== '1') {
      rulesDetails.open = false;
      rulesDetails.dataset.autoCollapsed = '1';
    }

    const hasSubmitted = round.guess !== null;
    const canAct = round.status === 'active' && !hasSubmitted && !pendingDrawLock;

    // Status banner
    studentStatusBanner.hidden = true;
    studentStatusBanner.className = 'alert';
    if (round.status === 'locked') {
      studentStatusBanner.hidden = false;
      studentStatusBanner.classList.add('alert-warn');
      studentStatusBanner.textContent = hasSubmitted
        ? 'Submissions are locked. Waiting for your instructor to reveal the hidden K.'
        : 'Your instructor has locked submissions for this round. Waiting for K to be revealed.';
    } else if (round.status === 'revealed') {
      studentStatusBanner.hidden = false;
      studentStatusBanner.classList.add('alert-success');
      studentStatusBanner.textContent = `Round ${round.roundNumber} complete — the hidden value K = ${formatNum(round.secretK)} has been revealed!`;
    }

    // Draw buttons
    drawButtons.forEach((btn) => {
      btn.disabled = !canAct;
    });
    customDrawInput.disabled = !canAct;
    customDrawBtn.disabled = !canAct;

    // Guess panel
    if (hasSubmitted) {
      guessFormWrap.hidden = true;
      guessLockedWrap.hidden = false;
      lockedGuessValue.textContent = `K̂ = ${formatNum(round.guess)}`;
      lockedGuessMeta.textContent =
        round.status === 'revealed'
          ? `Locked in after requesting ${round.count} number${round.count === 1 ? '' : 's'}.`
          : `Locked in after requesting ${round.count} number${round.count === 1 ? '' : 's'}. Waiting for instructor to reveal K.`;
    } else {
      guessFormWrap.hidden = false;
      guessLockedWrap.hidden = true;
      const canSubmit = round.status === 'active' && round.count >= 1;
      guessInput.disabled = round.status !== 'active';
      submitGuessBtn.disabled = !canSubmit;
      if (round.status !== 'active') {
        guessHelperText.textContent = 'Submissions are currently closed for this round.';
      } else if (round.count < 1) {
        guessHelperText.textContent = 'Request at least 1 number first before locking in your guess.';
      } else {
        guessHelperText.textContent = `Ready to guess with ${round.count} number${round.count === 1 ? '' : 's'} requested. Only one guess is allowed per round.`;
      }
    }

    // Stats strip
    statCount.textContent = String(round.count);
    statMin.textContent = round.min !== null ? formatNum(round.min) : '-';
    statMax.textContent = round.max !== null ? formatNum(round.max) : '-';
    if (round.status === 'revealed') {
      statStatus.textContent = 'Revealed';
    } else if (hasSubmitted) {
      statStatus.textContent = 'Submitted';
    } else if (round.status === 'locked') {
      statStatus.textContent = 'Locked';
    } else if (round.count > 0) {
      statStatus.textContent = 'Sampling';
    } else {
      statStatus.textContent = 'Ready';
    }

    // Render sorted sample chips with new-draw highlight
    sampleNumbers.innerHTML = '';
    if (round.sortedDraws.length === 0) {
      sampleEmpty.hidden = false;
    } else {
      sampleEmpty.hidden = true;
      const highlightCounts = new Map();
      highlightValues.forEach((v) => {
        highlightCounts.set(v, (highlightCounts.get(v) || 0) + 1);
      });

      const fragment = document.createDocumentFragment();
      round.sortedDraws.forEach((val) => {
        const chip = document.createElement('span');
        const remaining = highlightCounts.get(val) || 0;
        if (remaining > 0) {
          chip.className = 'chip is-new';
          highlightCounts.set(val, remaining - 1);
        } else {
          chip.className = 'chip';
        }
        chip.textContent = String(val);
        fragment.appendChild(chip);
      });
      sampleNumbers.appendChild(fragment);
    }

    if (round.requestHistory.length > 0) {
      requestHistoryLine.hidden = false;
      requestHistoryLine.textContent = `Request steps: ${round.requestHistory.map((n) => `+${n}`).join(' → ')} (total ${round.count})`;
    } else {
      requestHistoryLine.hidden = true;
    }

    // Reveal card & class leaderboard
    if (round.status === 'revealed' && round.secretK !== null) {
      revealCard.hidden = false;
      revealKValue.textContent = `K = ${formatNum(round.secretK)}`;

      if (round.rank !== null) {
        revealRankBadge.hidden = false;
        revealRankBadge.textContent = `Rank #${round.rank} of ${round.totalGroups}`;
      } else {
        revealRankBadge.hidden = true;
      }

      if (round.guess !== null && round.score !== null) {
        revealScoreBreakdown.innerHTML = `
          <span>Your Score =</span>
          <span class="fraction">
            <span class="fraction-top">100</span>
            <span class="fraction-bottom">${round.count} + |${formatNum(round.guess)} − ${formatNum(round.secretK)}|</span>
          </span>
          <span>=</span>
          <span class="fraction">
            <span class="fraction-top">100</span>
            <span class="fraction-bottom">${round.count} + ${formatNum(round.absError)}</span>
          </span>
          <span>=</span>
          <span class="score-final-num">${formatScore(round.score)}</span>
        `;
      } else {
        revealScoreBreakdown.innerHTML = `<span class="small" style="margin:0;">Your group did not lock in a guess before this round closed.</span>`;
      }

      if (round.leaderboard && round.leaderboard.length > 0) {
        studentLeaderboardSection.hidden = false;
        studentLbRound.textContent = String(round.roundNumber);
        studentLbBody.innerHTML = round.leaderboard
          .map(
            (entry) => `
            <tr class="${entry.groupId === state.group.id ? 'is-own' : ''}">
              <td>${entry.rank !== null ? `#${entry.rank}` : '—'}</td>
              <td>${escapeHtml(entry.groupName)}${entry.groupId === state.group.id ? ' (You)' : ''}</td>
              <td>${entry.requestedCount}</td>
              <td>${entry.guess !== null ? formatNum(entry.guess) : '—'}</td>
              <td>${entry.absError !== null ? formatNum(entry.absError) : '—'}</td>
              <td><strong>${formatScore(entry.score)}</strong></td>
            </tr>
          `
          )
          .join('');
      } else {
        studentLeaderboardSection.hidden = true;
      }
    } else {
      revealCard.hidden = true;
      studentLeaderboardSection.hidden = true;
    }

    // Past rounds table
    if (state.pastRounds && state.pastRounds.length > 0) {
      pastRoundsSection.hidden = false;
      pastRoundsBody.innerHTML = state.pastRounds
        .map(
          (pr) => `
          <tr>
            <td>Round ${pr.roundNumber}</td>
            <td>${pr.secretK !== null ? formatNum(pr.secretK) : 'Hidden'}</td>
            <td>${pr.requestedCount}</td>
            <td>${pr.guess !== null ? formatNum(pr.guess) : '—'}</td>
            <td>${pr.absError !== null ? formatNum(pr.absError) : '—'}</td>
            <td><strong>${formatScore(pr.score)}</strong></td>
          </tr>
        `
        )
        .join('');
    } else {
      pastRoundsSection.hidden = true;
    }
  }

  // Event handlers: Join / Create group
  createGroupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(createGroupError, '');
    const groupName = newGroupNameInput.value.trim();
    if (!groupName) {
      setError(createGroupError, 'Please enter a group name.');
      return;
    }

    createGroupBtn.disabled = true;
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}/groups`, {
        method: 'POST',
        body: JSON.stringify({ groupName }),
      });
      showToast(`Joined as ${data.group.name} (Team PIN: ${data.group.teamCode})`, 'success');
      enterGroupPlay(data.group);
    } catch (err) {
      setError(createGroupError, err.message);
      // Refresh group list in case another teammate just created the group
      apiJson(`/api/sessions/${encodeURIComponent(roomCode)}`)
        .then((info) => renderExistingGroups(info.groups))
        .catch(() => {});
    } finally {
      createGroupBtn.disabled = false;
    }
  });

  joinExistingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(joinExistingError, '');
    if (!selectedExistingGroup) {
      setError(joinExistingError, 'Select a group from the list first.');
      return;
    }
    const teamCode = existingTeamCodeInput.value.trim();
    if (!teamCode) {
      setError(joinExistingError, 'Enter the 4-digit Team PIN.');
      return;
    }

    joinExistingBtn.disabled = true;
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}/groups/join`, {
        method: 'POST',
        body: JSON.stringify({ groupId: selectedExistingGroup.id, teamCode }),
      });
      showToast(`Synced with ${data.group.name}!`, 'success');
      enterGroupPlay(data.group);
    } catch (err) {
      setError(joinExistingError, err.message);
    } finally {
      joinExistingBtn.disabled = false;
    }
  });

  switchGroupBtn.addEventListener('click', () => {
    if (!window.confirm('Leave this group on this device and return to the group picker?')) return;
    clearStudentSession(roomCode);
    currentGroupAuth = null;
    currentState = null;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    topbarGroupBadge.hidden = true;
    topbarTeamCode.hidden = true;
    topbarRoundBadge.hidden = true;
    switchGroupBtn.hidden = true;
    loadRoomAndInit();
  });

  // Event handlers: Drawing numbers
  function requestDraws(count) {
    if (!socket || pendingDrawLock) return;
    pendingDrawLock = true;
    drawButtons.forEach((b) => {
      b.disabled = true;
    });
    customDrawBtn.disabled = true;

    socket.emit('student:draw', { count }, (res) => {
      pendingDrawLock = false;
      if (!res || !res.ok) {
        showToast(res?.error || 'Could not request numbers.', 'error');
        if (currentState) applyStudentState(currentState);
        return;
      }
      if (currentState) applyStudentState(currentState);
    });
  }

  drawButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const count = Number.parseInt(btn.dataset.count || '1', 10);
      requestDraws(count);
    });
  });

  customDrawForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const count = Number.parseInt(customDrawInput.value, 10);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      showToast('Enter a whole number between 1 and 100.', 'error');
      return;
    }
    customDrawInput.value = '';
    requestDraws(count);
  });

  // Event handlers: Guess submission & confirmation modal
  function openConfirmModal(guessVal) {
    const round = currentState?.round;
    if (!round) return;

    pendingGuessValue = guessVal;
    confirmRequestedVal.textContent = String(round.count);
    confirmGuessVal.textContent = formatNum(guessVal);

    if (round.max !== null && guessVal < round.max) {
      confirmWarningBox.hidden = false;
      confirmWarningBox.textContent = `Heads up: your guess (${formatNum(guessVal)}) is smaller than the largest number you already observed (${formatNum(round.max)}). Since draws come from 1 to K, K must be at least ${formatNum(round.max)}.`;
    } else {
      confirmWarningBox.hidden = true;
    }

    confirmModal.hidden = false;
  }

  function closeConfirmModal() {
    confirmModal.hidden = true;
    pendingGuessValue = null;
  }

  guessForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const round = currentState?.round;
    if (!round || round.status !== 'active') return;
    if (round.count < 1) {
      showToast('Request at least 1 number before submitting your guess.', 'error');
      return;
    }

    const parsed = Number.parseInt(guessInput.value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      showToast('Please enter a positive whole number for your guess.', 'error');
      guessInput.focus();
      return;
    }

    openConfirmModal(parsed);
  });

  confirmCloseBtn.addEventListener('click', closeConfirmModal);
  confirmCancelBtn.addEventListener('click', closeConfirmModal);
  confirmModal.addEventListener('click', (event) => {
    if (event.target === confirmModal) closeConfirmModal();
  });

  confirmSubmitBtn.addEventListener('click', () => {
    if (!socket || pendingGuessValue === null) return;
    const guessToSend = pendingGuessValue;
    confirmSubmitBtn.disabled = true;

    socket.emit('student:submit_guess', { guess: guessToSend }, (res) => {
      confirmSubmitBtn.disabled = false;
      closeConfirmModal();
      if (!res || !res.ok) {
        showToast(res?.error || 'Could not submit guess.', 'error');
        return;
      }
      showToast(`Guess K̂ = ${formatNum(guessToSend)} locked in!`, 'success');
    });
  });

  loadRoomAndInit();
})();
