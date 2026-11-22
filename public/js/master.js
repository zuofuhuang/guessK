(function () {
  const {
    apiUrl,
    createSocket,
    escapeHtml,
    formatTime,
    formatScore,
    formatNum,
    showToast,
    copyText,
    saveMasterSession,
    getMasterKey,
    apiJson,
    getRoomCodeFromPath,
  } = window.GuessK;

  const roomCode = getRoomCodeFromPath('master');

  // Topbar elements
  const masterRoomCodeEl = document.getElementById('master-room-code');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const showQrBtn = document.getElementById('show-qr-btn');
  const privacyToggleBtn = document.getElementById('privacy-toggle-btn');
  const privacyToggleText = document.getElementById('privacy-toggle-text');
  const exportSummaryBtn = document.getElementById('export-summary-btn');
  const exportEventsBtn = document.getElementById('export-events-btn');
  const masterConnDot = document.getElementById('master-conn-dot');
  const masterConnLabel = document.getElementById('master-conn-label');

  // Auth gate elements
  const authGate = document.getElementById('master-auth-gate');
  const authGateRoom = document.getElementById('auth-gate-room');
  const authForm = document.getElementById('master-auth-form');
  const authInput = document.getElementById('master-auth-input');
  const authError = document.getElementById('master-auth-error');
  const workspace = document.getElementById('master-workspace');

  // Round strip & sidebar elements
  const roundPills = document.getElementById('round-pills');
  const hostKeyChip = document.getElementById('host-key-chip');
  const copyHostKeyBtn = document.getElementById('copy-host-key-btn');

  const kInput = document.getElementById('k-input');
  const startRoundBtn = document.getElementById('start-round-btn');

  const activeRoundStatusBadge = document.getElementById('active-round-status-badge');
  const lockToggleBtn = document.getElementById('lock-toggle-btn');
  const revealKBtn = document.getElementById('reveal-k-btn');
  const hideKBtn = document.getElementById('hide-k-btn');
  const viewingRoundNum = document.getElementById('viewing-round-num');
  const masterRevealText = document.getElementById('master-reveal-text');
  const masterRevealValue = document.getElementById('master-reveal-value');
  const activityFeed = document.getElementById('activity-feed');

  // KPI elements
  const kpiGroups = document.getElementById('kpi-groups');
  const kpiOnline = document.getElementById('kpi-online');
  const kpiSubmitted = document.getElementById('kpi-submitted');
  const kpiSubmittedSub = document.getElementById('kpi-submitted-sub');
  const kpiAvgReq = document.getElementById('kpi-avg-req');
  const kpiTopScore = document.getElementById('kpi-top-score');
  const kpiTopWinner = document.getElementById('kpi-top-winner');

  // Tabs & table
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const panelTracker = document.getElementById('panel-tracker');
  const panelCharts = document.getElementById('panel-charts');
  const panelCumulative = document.getElementById('panel-cumulative');
  const privacyHintBadge = document.getElementById('privacy-hint-badge');

  const trackerEmpty = document.getElementById('tracker-empty');
  const emptyRoomCode = document.getElementById('empty-room-code');
  const trackerTableWrap = document.getElementById('tracker-table-wrap');
  const trackerTbody = document.getElementById('tracker-tbody');
  const sortHeaders = Array.from(document.querySelectorAll('.tracker-table th.sortable'));

  // Charts & cumulative
  const chartsLockedNotice = document.getElementById('charts-locked-notice');
  const chartsContent = document.getElementById('charts-content');
  const chartGuessesContainer = document.getElementById('chart-guesses-container');
  const chartScatterContainer = document.getElementById('chart-scatter-container');
  const cumulativeEmpty = document.getElementById('cumulative-empty');
  const cumulativeTableWrap = document.getElementById('cumulative-table-wrap');
  const cumulativeThead = document.getElementById('cumulative-thead');
  const cumulativeTbody = document.getElementById('cumulative-tbody');

  // QR Modal
  const qrModal = document.getElementById('qr-modal');
  const qrCloseBtn = document.getElementById('qr-close-btn');
  const qrSvgContainer = document.getElementById('qr-svg-container');
  const qrRoomCodeBig = document.getElementById('qr-room-code-big');
  const qrJoinUrlEl = document.getElementById('qr-join-url');
  const qrCopyBtn = document.getElementById('qr-copy-btn');

  // Inspector Drawer
  const inspectorDrawer = document.getElementById('inspector-drawer');
  const inspectorCloseBtn = document.getElementById('inspector-close-btn');
  const inspectorTitle = document.getElementById('inspector-title');
  const inspectorPinBadge = document.getElementById('inspector-pin-badge');
  const inspectorOnlineBadge = document.getElementById('inspector-online-badge');
  const inspectorStatusBadge = document.getElementById('inspector-status-badge');
  const inspectorPrivacyNote = document.getElementById('inspector-privacy-note');
  const inspectorCount = document.getElementById('inspector-count');
  const inspectorGuess = document.getElementById('inspector-guess');
  const inspectorError = document.getElementById('inspector-error');
  const inspectorScore = document.getElementById('inspector-score');
  const inspectorSampleSection = document.getElementById('inspector-sample-section');
  const inspectorEstimators = document.getElementById('inspector-estimators');
  const inspectorChips = document.getElementById('inspector-chips');
  const inspectorChipsEmpty = document.getElementById('inspector-chips-empty');
  const inspectorTimeline = document.getElementById('inspector-timeline');
  const inspectorUnlockBtn = document.getElementById('inspector-unlock-btn');
  const inspectorRemoveBtn = document.getElementById('inspector-remove-btn');

  // State
  let socket = null;
  let hostSecret = '';
  let masterState = null;
  let selectedRoundNumber = null;
  let lastKnownActiveRound = null;
  let activeTab = 'tracker';
  let projectorSafe = true;
  let secretKBuffer = '';
  let replaceOnNextDigit = false;
  let sortKey = 'status';
  let sortDir = 1;
  let inspectedGroupId = null;

  function joinUrl() {
    return `${window.location.origin}/play/${roomCode}`;
  }

  function setConnStatus(online, label) {
    masterConnDot.className = `dot ${online ? 'online' : 'offline'}`;
    masterConnLabel.textContent = label;
  }

  function getViewingRound() {
    if (!masterState || masterState.rounds.length === 0) return null;
    if (selectedRoundNumber !== null) {
      const found = masterState.rounds.find((r) => r.roundNumber === selectedRoundNumber);
      if (found) return found;
    }
    return masterState.rounds[masterState.rounds.length - 1];
  }

  function getActiveRound() {
    if (!masterState || masterState.activeRoundNumber === null) return null;
    return masterState.rounds.find((r) => r.roundNumber === masterState.activeRoundNumber) || null;
  }

  function shouldMaskValues(round) {
    if (!round) return projectorSafe;
    return projectorSafe && round.status !== 'revealed';
  }

  // Masked K input (exact UX preserved from guessK.html)
  function syncMaskedKInput() {
    kInput.value = secretKBuffer ? '•'.repeat(secretKBuffer.length) : '';
  }

  kInput.addEventListener('focus', () => {
    replaceOnNextDigit = true;
  });

  kInput.addEventListener('blur', () => {
    syncMaskedKInput();
  });

  kInput.addEventListener('keydown', (event) => {
    const { key } = event;
    if (key === 'Tab') return;
    if (key === 'Enter') {
      event.preventDefault();
      handleStartRound();
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      secretKBuffer = secretKBuffer.slice(0, -1);
      replaceOnNextDigit = false;
      syncMaskedKInput();
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      secretKBuffer = '';
      replaceOnNextDigit = false;
      syncMaskedKInput();
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      secretKBuffer = replaceOnNextDigit ? key : `${secretKBuffer}${key}`;
      replaceOnNextDigit = false;
      syncMaskedKInput();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      return;
    }
    if (key.length === 1) {
      event.preventDefault();
    }
  });

  kInput.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') || '').replace(/\D/g, '');
    if (!pasted) return;
    secretKBuffer = replaceOnNextDigit ? pasted : `${secretKBuffer}${pasted}`;
    replaceOnNextDigit = false;
    syncMaskedKInput();
  });

  // Projector-Safe toggle
  function updatePrivacyUi() {
    privacyToggleBtn.classList.toggle('is-off', !projectorSafe);
    privacyToggleText.textContent = projectorSafe ? 'Projector-Safe: ON' : 'Projector-Safe: OFF (Private View)';
    if (masterState) renderAll();
  }

  privacyToggleBtn.addEventListener('click', () => {
    projectorSafe = !projectorSafe;
    updatePrivacyUi();
    showToast(
      projectorSafe
        ? 'Projector-Safe Mode ON — K, sample ranges, and guesses masked until Reveal.'
        : 'Projector-Safe Mode OFF — private instructor values visible.',
      projectorSafe ? 'success' : 'default'
    );
  });

  // Tabs
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab || 'tracker';
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
      panelTracker.hidden = activeTab !== 'tracker';
      panelCharts.hidden = activeTab !== 'charts';
      panelCumulative.hidden = activeTab !== 'cumulative';
      renderAll();
    });
  });

  // Sortable columns
  sortHeaders.forEach((th) => {
    th.addEventListener('click', () => {
      const nextKey = th.dataset.sort;
      if (!nextKey) return;
      if (sortKey === nextKey) {
        sortDir = -sortDir;
      } else {
        sortKey = nextKey;
        sortDir = nextKey === 'score' || nextKey === 'requestedCount' ? -1 : 1;
      }
      renderTrackerTable(getViewingRound());
    });
  });

  function connectMasterSocket(secret) {
    hostSecret = secret;
    saveMasterSession(roomCode, hostSecret);

    if (socket) {
      socket.disconnect();
      socket = null;
    }

    setConnStatus(false, 'Connecting…');
    socket = createSocket();

    socket.on('connect', () => {
      setConnStatus(true, 'Live');
      socket.emit('master:auth', { roomCode, hostSecret }, (res) => {
        if (!res || !res.ok) {
          authGate.hidden = false;
          workspace.hidden = true;
          authError.hidden = false;
          authError.textContent = res?.error || 'Could not authenticate as instructor.';
          setConnStatus(false, 'Locked');
          return;
        }
        authGate.hidden = true;
        workspace.hidden = false;
        authError.hidden = true;
        applyMasterState(res.state);
      });
    });

    socket.on('disconnect', () => {
      setConnStatus(false, 'Reconnecting…');
    });

    socket.on('master:state', (state) => {
      applyMasterState(state);
    });
  }

  function applyMasterState(state) {
    masterState = state;
    if (state.activeRoundNumber !== null && state.activeRoundNumber !== lastKnownActiveRound) {
      selectedRoundNumber = state.activeRoundNumber;
      lastKnownActiveRound = state.activeRoundNumber;
    } else if (selectedRoundNumber === null && state.activeRoundNumber !== null) {
      selectedRoundNumber = state.activeRoundNumber;
    }
    renderAll();
  }

  function renderAll() {
    if (!masterState) return;

    const activeRound = getActiveRound();
    const viewingRound = getViewingRound();
    const masked = shouldMaskValues(viewingRound);

    // Next round button label
    const nextRoundNum = masterState.rounds.length + 1;
    startRoundBtn.textContent = `Start Round ${nextRoundNum}`;

    // Round switcher pills
    if (masterState.rounds.length === 0) {
      roundPills.innerHTML =
        '<span class="small" style="margin:0;">Lobby open — enter a hidden K and click Start Round 1 when ready.</span>';
    } else {
      roundPills.innerHTML = '';
      masterState.rounds.forEach((r) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `round-pill${viewingRound?.roundNumber === r.roundNumber ? ' active' : ''}`;
        const statusDot = r.status === 'revealed' ? ' ✓' : r.status === 'locked' ? ' (Locked)' : ' • Live';
        pill.textContent = `Round ${r.roundNumber}${statusDot}`;
        pill.addEventListener('click', () => {
          selectedRoundNumber = r.roundNumber;
          renderAll();
        });
        roundPills.appendChild(pill);
      });
    }

    // Active round lifecycle controls
    if (!activeRound) {
      activeRoundStatusBadge.textContent = 'Lobby (No Active Round)';
      activeRoundStatusBadge.className = 'badge';
      lockToggleBtn.disabled = true;
      lockToggleBtn.textContent = 'Lock Submissions';
      revealKBtn.disabled = true;
      hideKBtn.disabled = true;
      hideKBtn.hidden = true;
    } else {
      if (activeRound.status === 'active') {
        activeRoundStatusBadge.textContent = `Round ${activeRound.roundNumber} · Open`;
        activeRoundStatusBadge.className = 'badge badge-success';
        lockToggleBtn.disabled = false;
        lockToggleBtn.textContent = 'Lock Submissions';
        revealKBtn.disabled = false;
        hideKBtn.disabled = true;
        hideKBtn.hidden = true;
      } else if (activeRound.status === 'locked') {
        activeRoundStatusBadge.textContent = `Round ${activeRound.roundNumber} · Locked`;
        activeRoundStatusBadge.className = 'badge badge-warn';
        lockToggleBtn.disabled = false;
        lockToggleBtn.textContent = 'Reopen Submissions';
        revealKBtn.disabled = false;
        hideKBtn.disabled = true;
        hideKBtn.hidden = true;
      } else {
        activeRoundStatusBadge.textContent = `Round ${activeRound.roundNumber} · Revealed`;
        activeRoundStatusBadge.className = 'badge badge-accent';
        lockToggleBtn.disabled = true;
        lockToggleBtn.textContent = 'Round Revealed';
        revealKBtn.disabled = true;
        hideKBtn.disabled = false;
        hideKBtn.hidden = false;
      }
    }

    // Hidden Answer box for viewingRound
    if (!viewingRound) {
      viewingRoundNum.textContent = '—';
      masterRevealText.textContent = 'Start a round to lock in a secret K.';
      masterRevealValue.textContent = '';
    } else {
      viewingRoundNum.textContent = String(viewingRound.roundNumber);
      if (viewingRound.status === 'revealed') {
        masterRevealText.textContent = 'Hidden K has been revealed to all student screens.';
        masterRevealValue.textContent = `K = ${formatNum(viewingRound.secretK)}`;
      } else if (!projectorSafe) {
        masterRevealText.textContent = 'Private instructor preview (still hidden from students):';
        masterRevealValue.textContent = `K = ${formatNum(viewingRound.secretK)}`;
      } else {
        masterRevealText.textContent = 'K is locked in and hidden on all screens (Projector-Safe ON).';
        masterRevealValue.textContent = 'Hidden';
      }
    }

    // Privacy banner badge above tabs
    if (viewingRound && viewingRound.status === 'revealed') {
      privacyHintBadge.className = 'badge badge-success';
      privacyHintBadge.textContent = `Round ${viewingRound.roundNumber} revealed · K = ${formatNum(viewingRound.secretK)}`;
    } else if (projectorSafe) {
      privacyHintBadge.className = 'badge badge-success';
      privacyHintBadge.textContent = 'Projector-Safe: guesses & sample ranges masked';
    } else {
      privacyHintBadge.className = 'badge badge-warn';
      privacyHintBadge.textContent = 'Private Mode: live guesses & samples visible';
    }

    // KPIs
    const totalGroups = masterState.groups.length;
    const onlineGroups = masterState.groups.filter((g) => g.online).length;
    kpiGroups.textContent = String(totalGroups);
    kpiOnline.textContent = `${onlineGroups} online now`;

    if (!viewingRound) {
      kpiSubmitted.textContent = `0 / ${totalGroups}`;
      kpiSubmittedSub.textContent = 'Start Round 1 to begin';
      kpiAvgReq.textContent = '—';
      kpiTopScore.textContent = '—';
      kpiTopWinner.textContent = 'Shown after Reveal';
    } else {
      const s = viewingRound.summary;
      kpiSubmitted.textContent = `${s.submittedGroups} / ${s.totalGroups}`;
      kpiSubmittedSub.textContent =
        s.totalGroups > 0
          ? `${Math.round((s.submittedGroups / s.totalGroups) * 100)}% locked in`
          : 'Waiting for groups';
      kpiAvgReq.textContent = s.avgRequested !== null ? s.avgRequested.toFixed(1) : '—';

      if (masked) {
        kpiTopScore.textContent = 'Hidden';
        kpiTopWinner.textContent = 'Shown after Reveal';
      } else if (s.topScore !== null) {
        kpiTopScore.textContent = formatScore(s.topScore);
        kpiTopWinner.textContent = s.topScorerNames.join(', ');
      } else {
        kpiTopScore.textContent = '—';
        kpiTopWinner.textContent = 'No guesses submitted yet';
      }
    }

    renderTrackerTable(viewingRound);
    renderActivityFeed(viewingRound);
    if (activeTab === 'charts') {
      renderDebriefCharts(viewingRound);
    }
    if (activeTab === 'cumulative') {
      renderCumulativeTable();
    }
    if (inspectedGroupId) {
      renderInspectorDrawer(viewingRound);
    }
  }

  function renderTrackerTable(viewingRound) {
    const groupsList = masterState?.groups || [];
    if (groupsList.length === 0) {
      trackerEmpty.hidden = false;
      trackerTableWrap.hidden = true;
      return;
    }

    trackerEmpty.hidden = true;
    trackerTableWrap.hidden = false;
    const masked = shouldMaskValues(viewingRound);
    const isActiveViewing =
      viewingRound && masterState.activeRoundNumber === viewingRound.roundNumber;

    // Build rows (even during Lobby before Round 1 starts)
    const rows = viewingRound
      ? [...viewingRound.groups]
      : groupsList.map((g) => ({
          groupId: g.id,
          groupName: g.name,
          teamCode: g.teamCode,
          connectedDevices: g.connectedDevices,
          online: g.online,
          status: 'waiting',
          requestedCount: 0,
          requestHistory: [],
          draws: [],
          sortedDraws: [],
          min: null,
          max: null,
          mean: null,
          momEstimate: null,
          maxAdjustedEstimate: null,
          guess: null,
          submittedAt: null,
          absError: null,
          score: null,
          rank: null,
        }));

    // Sort rows
    const statusOrder = { submitted: 0, sampling: 1, waiting: 2 };
    rows.sort((a, b) => {
      if (viewingRound?.status === 'revealed' && sortKey === 'status') {
        const ra = a.rank ?? 9999;
        const rb = b.rank ?? 9999;
        if (ra !== rb) return ra - rb;
      }
      let cmp = 0;
      switch (sortKey) {
        case 'rank':
          cmp = (a.rank ?? 9999) - (b.rank ?? 9999);
          break;
        case 'groupName':
          cmp = a.groupName.localeCompare(b.groupName);
          break;
        case 'requestedCount':
          cmp = a.requestedCount - b.requestedCount;
          break;
        case 'guess':
          cmp = (a.guess ?? -1) - (b.guess ?? -1);
          break;
        case 'absError':
          cmp = (a.absError ?? 999999999) - (b.absError ?? 999999999);
          break;
        case 'score':
          cmp = (a.score ?? -1) - (b.score ?? -1);
          break;
        default:
          cmp = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
          if (cmp === 0) cmp = b.requestedCount - a.requestedCount;
      }
      if (cmp !== 0) return cmp * sortDir;
      return a.groupName.localeCompare(b.groupName);
    });

    trackerTbody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (!masked && row.rank === 1 && row.score !== null) {
        tr.className = 'is-winner';
      }

      const statusBadge =
        row.status === 'submitted'
          ? '<span class="badge badge-success">Submitted</span>'
          : row.status === 'sampling'
            ? '<span class="badge badge-accent">Sampling</span>'
            : '<span class="badge">Waiting</span>';

      const rangeCell =
        row.requestedCount === 0
          ? '—'
          : masked
            ? '<span class="masked-pill">Hidden</span>'
            : `${formatNum(row.min)} – ${formatNum(row.max)}`;

      const guessCell =
        row.guess === null
          ? '—'
          : masked
            ? '<span class="masked-pill">Locked ✓</span>'
            : `<strong>${formatNum(row.guess)}</strong>`;

      const errorCell =
        row.absError === null
          ? '—'
          : masked
            ? '<span class="masked-pill">—</span>'
            : formatNum(row.absError);

      const scoreCell =
        row.score === null
          ? '—'
          : masked
            ? '<span class="masked-pill">—</span>'
            : `<strong style="color:var(--success);">${formatScore(row.score)}</strong>`;

      const rankCell = !masked && row.rank !== null ? `<strong>#${row.rank}</strong>` : '—';

      const stepsText =
        row.requestHistory.length > 0
          ? ` <span class="small" style="font-size:0.76rem;">(${row.requestHistory.map((n) => `+${n}`).join(', ')})</span>`
          : '';

      const canUnlock =
        isActiveViewing &&
        viewingRound.status !== 'revealed' &&
        row.guess !== null;

      tr.innerHTML = `
        <td>${rankCell}</td>
        <td>
          <div class="group-cell">
            <span class="dot ${row.online ? 'online' : 'offline'}" title="${row.online ? `${row.connectedDevices} device(s) online` : 'Offline'}"></span>
            <span>${escapeHtml(row.groupName)}</span>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td><strong>${row.requestedCount}</strong>${stepsText}</td>
        <td>${rangeCell}</td>
        <td>${guessCell}</td>
        <td>${errorCell}</td>
        <td>${scoreCell}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="ghost btn-sm inspect-btn">Inspect</button>
            ${canUnlock ? '<button type="button" class="secondary btn-sm unlock-btn">Unlock</button>' : ''}
          </div>
        </td>
      `;

      tr.querySelector('.inspect-btn').addEventListener('click', () => {
        inspectedGroupId = row.groupId;
        inspectorDrawer.hidden = false;
        renderInspectorDrawer(viewingRound);
      });

      const unlockBtn = tr.querySelector('.unlock-btn');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', () => handleUnlockGroup(row.groupId, row.groupName));
      }

      trackerTbody.appendChild(tr);
    });
  }

  function formatEventDescription(ev, masked) {
    const who = ev.groupName ? `<strong>${escapeHtml(ev.groupName)}</strong>` : '<strong>Instructor</strong>';
    switch (ev.type) {
      case 'joined':
        return `${who} joined the room.`;
      case 'draw':
        return `${who} requested <strong>+${ev.payload.requested}</strong> (total ${ev.payload.totalAfter}).`;
      case 'submit':
        return masked
          ? `${who} locked in their guess (after ${ev.payload.totalAfter} draws).`
          : `${who} guessed <strong>${formatNum(ev.payload.guess)}</strong> (after ${ev.payload.totalAfter} draws).`;
      case 'unlock':
        return ev.groupName
          ? `Instructor unlocked ${who}&apos;s guess.`
          : escapeHtml(ev.payload.note || 'Round reopened.');
      case 'round_started':
        return escapeHtml(ev.payload.note || `Round ${ev.roundNumber} started.`);
      case 'round_locked':
        return `Round ${ev.roundNumber} submissions locked.`;
      case 'round_revealed':
        return masked
          ? `Round ${ev.roundNumber} revealed.`
          : escapeHtml(ev.payload.note || `Round ${ev.roundNumber} revealed.`);
      case 'round_hidden':
        return `Round ${ev.roundNumber} hidden again.`;
      default:
        return escapeHtml(ev.payload.note || ev.type);
    }
  }

  function renderActivityFeed(viewingRound) {
    const events = (masterState?.events || []).slice().reverse().slice(0, 40);
    if (events.length === 0) {
      activityFeed.innerHTML = '<p class="empty">No decisions recorded yet.</p>';
      return;
    }

    const roundsByNum = new Map((masterState?.rounds || []).map((r) => [r.roundNumber, r]));

    activityFeed.innerHTML = events
      .map((ev) => {
        const evRound = roundsByNum.get(ev.roundNumber) || viewingRound;
        const masked = shouldMaskValues(evRound);
        return `
          <div class="activity-item">
            <span class="activity-time">${escapeHtml(formatTime(ev.timestamp))}</span>
            ${formatEventDescription(ev, masked)}
          </div>
        `;
      })
      .join('');
  }

  function renderDebriefCharts(viewingRound) {
    if (!viewingRound) {
      chartsLockedNotice.hidden = false;
      chartsLockedNotice.textContent = 'Start a round and reveal K to view debrief charts.';
      chartsContent.hidden = true;
      return;
    }

    if (shouldMaskValues(viewingRound)) {
      chartsLockedNotice.hidden = false;
      chartsLockedNotice.innerHTML =
        'Debrief charts unlock automatically once you click <strong>Reveal K &amp; Scores</strong> (or turn off Projector-Safe Mode to preview privately).';
      chartsContent.hidden = true;
      return;
    }

    const submitted = viewingRound.groups.filter((g) => g.guess !== null && g.score !== null);
    if (submitted.length === 0) {
      chartsLockedNotice.hidden = false;
      chartsLockedNotice.textContent = 'No group guesses have been submitted for this round yet.';
      chartsContent.hidden = true;
      return;
    }

    chartsLockedNotice.hidden = true;
    chartsContent.hidden = false;
    renderGuessesStripSvg(viewingRound, submitted);
    renderScatterSvg(viewingRound, submitted);
  }

  function renderGuessesStripSvg(round, submitted) {
    const width = 760;
    const rowHeight = 32;
    const padTop = 36;
    const padBottom = 42;
    const padLeft = 140;
    const padRight = 56;
    const height = Math.max(170, padTop + padBottom + submitted.length * rowHeight);

    const allVals = [round.secretK, ...submitted.map((g) => g.guess)];
    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    const span = Math.max(1, maxVal - minVal);
    const domainMin = Math.max(0, minVal - span * 0.14);
    const domainMax = maxVal + span * 0.14;

    const plotW = width - padLeft - padRight;
    const xOf = (val) => padLeft + ((val - domainMin) / (domainMax - domainMin)) * plotW;

    const sorted = [...submitted].sort((a, b) => a.guess - b.guess);
    const kX = xOf(round.secretK);

    // Build 5 clean axis ticks
    const ticks = [];
    for (let i = 0; i <= 4; i += 1) {
      const val = domainMin + ((domainMax - domainMin) * i) / 4;
      ticks.push({ x: xOf(val), label: Math.round(val).toLocaleString() });
    }

    const rowsSvg = sorted
      .map((g, i) => {
        const y = padTop + i * rowHeight + rowHeight / 2;
        const gx = xOf(g.guess);
        const isWinner = g.rank === 1;
        const color = isWinner ? '#2f7c49' : '#bf673d';
        const placeLeft = g.guess < round.secretK && gx > padLeft + 34;
        const labelX = placeLeft ? gx - 11 : gx + 11;
        const labelAnchor = placeLeft ? 'end' : 'start';
        return `
          <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#efe4d4" stroke-width="1" />
          <line x1="${Math.min(gx, kX)}" y1="${y}" x2="${Math.max(gx, kX)}" y2="${y}" stroke="${color}" stroke-opacity="0.38" stroke-width="3" />
          <text x="${padLeft - 12}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="12" fill="#24313b" font-weight="${isWinner ? '700' : '500'}">${escapeHtml(g.groupName.slice(0, 18))}</text>
          <circle cx="${gx}" cy="${y}" r="6.5" fill="${color}" stroke="#fffaf2" stroke-width="2">
            <title>${escapeHtml(g.groupName)}: Guess ${g.guess}, n=${g.requestedCount}, Error=${g.absError}, Score=${formatScore(g.score)}</title>
          </circle>
          <text x="${labelX}" y="${y + 4}" text-anchor="${labelAnchor}" font-family="sans-serif" font-size="11.5" font-weight="700" fill="${color}">${formatNum(g.guess)}</text>
        `;
      })
      .join('');

    const ticksSvg = ticks
      .map(
        (t) => `
        <line x1="${t.x}" y1="${height - padBottom}" x2="${t.x}" y2="${height - padBottom + 6}" stroke="#cdbca6" />
        <text x="${t.x}" y="${height - padBottom + 20}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#64717a">${t.label}</text>
      `
      )
      .join('');

    chartGuessesContainer.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Group guesses compared to actual K">
        <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="#cdbca6" stroke-width="1.5" />
        ${ticksSvg}
        <line x1="${kX}" y1="${padTop - 12}" x2="${kX}" y2="${height - padBottom}" stroke="#2f7c49" stroke-width="2.5" stroke-dasharray="5 4" />
        <rect x="${Math.max(padLeft, Math.min(kX - 48, width - padRight - 96))}" y="6" width="96" height="22" rx="11" fill="#eef7f0" stroke="#b9dcbf" />
        <text x="${Math.max(padLeft + 48, Math.min(kX, width - padRight - 48))}" y="21" text-anchor="middle" font-family="sans-serif" font-size="11.5" font-weight="700" fill="#2f7c49">Actual K = ${formatNum(round.secretK)}</text>
        ${rowsSvg}
      </svg>
    `;
  }

  function renderScatterSvg(round, submitted) {
    const width = 760;
    const height = 270;
    const padTop = 28;
    const padBottom = 46;
    const padLeft = 62;
    const padRight = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxN = Math.max(5, ...submitted.map((g) => g.requestedCount));
    const maxScore = Math.max(10, ...submitted.map((g) => g.score));
    const xDomainMax = Math.ceil(maxN * 1.15);
    const yDomainMax = Math.ceil(maxScore * 1.18);

    const xOf = (n) => padLeft + (n / xDomainMax) * plotW;
    const yOf = (s) => padTop + plotH - (s / yDomainMax) * plotH;

    let gridSvg = '';
    for (let i = 0; i <= 4; i += 1) {
      const yVal = (yDomainMax * i) / 4;
      const y = yOf(yVal);
      gridSvg += `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#efe4d4" />
        <text x="${padLeft - 10}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#64717a">${yVal.toFixed(1)}</text>
      `;

      const xVal = (xDomainMax * i) / 4;
      const x = xOf(xVal);
      gridSvg += `
        <line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + plotH}" stroke="#f4ecdf" />
        <text x="${x}" y="${height - padBottom + 18}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#64717a">${Math.round(xVal)}</text>
      `;
    }

    const placedLabels = [];
    const orderedForScatter = [...submitted].sort((a, b) => b.score - a.score);
    const pointsSvg = orderedForScatter
      .map((g) => {
        const cx = xOf(g.requestedCount);
        const cy = yOf(g.score);
        const isWinner = g.rank === 1;
        const fill = isWinner ? '#2f7c49' : '#bf673d';

        let labelY = cy - 12;
        const collidesAbove = placedLabels.some(
          (p) => Math.abs(p.x - cx) < 68 && Math.abs(p.y - labelY) < 16
        );
        if (collidesAbove || labelY < padTop + 8) {
          labelY = cy + 20;
        }
        placedLabels.push({ x: cx, y: labelY });

        return `
          <circle cx="${cx}" cy="${cy}" r="${isWinner ? 8 : 6.5}" fill="${fill}" fill-opacity="0.92" stroke="#fffaf2" stroke-width="2">
            <title>${escapeHtml(g.groupName)}: n=${g.requestedCount}, Guess=${g.guess}, Error=${g.absError}, Score=${formatScore(g.score)}</title>
          </circle>
          <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="${isWinner ? '700' : '500'}" fill="#24313b">${escapeHtml(g.groupName.slice(0, 14))}</text>
        `;
      })
      .join('');

    chartScatterContainer.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sample size versus score scatter plot">
        ${gridSvg}
        <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="#cdbca6" stroke-width="1.5" />
        <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="#cdbca6" stroke-width="1.5" />
        <text x="${padLeft + plotW / 2}" y="${height - 8}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="600" fill="#64717a">Numbers Requested (n)</text>
        <text x="16" y="${padTop + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="600" fill="#64717a" transform="rotate(-90 16 ${padTop + plotH / 2})">Score</text>
        ${pointsSvg}
      </svg>
    `;
  }

  function renderCumulativeTable() {
    if (!masterState || masterState.rounds.length === 0 || masterState.cumulative.length === 0) {
      cumulativeEmpty.hidden = false;
      cumulativeTableWrap.hidden = true;
      return;
    }

    cumulativeEmpty.hidden = true;
    cumulativeTableWrap.hidden = false;

    const rounds = masterState.rounds;
    const headerCells = [
      '<th>Rank</th>',
      '<th>Group</th>',
      ...rounds.map((r) => `<th>Round ${r.roundNumber}</th>`),
      '<th>Total Draws</th>',
      '<th>Total Score</th>',
    ];
    cumulativeThead.innerHTML = `<tr>${headerCells.join('')}</tr>`;

    cumulativeTbody.innerHTML = masterState.cumulative
      .map((row, idx) => {
        const roundCells = rounds
          .map((r) => {
            const cell = row.perRound[r.roundNumber];
            if (!cell) return '<td>—</td>';
            if (shouldMaskValues(r)) {
              return `<td>${cell.requestedCount} draws ${cell.guess !== null ? '✓' : ''}</td>`;
            }
            return `<td>${cell.score !== null ? `<strong>${formatScore(cell.score)}</strong> <span class="small">(n=${cell.requestedCount})</span>` : '—'}</td>`;
          })
          .join('');

        const anyMasked = rounds.some((r) => shouldMaskValues(r));
        const totalScoreText = anyMasked
          ? '<span class="masked-pill">Hidden</span>'
          : `<strong style="color:var(--success);">${formatScore(row.totalScore)}</strong>`;

        return `
          <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td><strong>${escapeHtml(row.groupName)}</strong></td>
            ${roundCells}
            <td>${row.totalRequested}</td>
            <td>${totalScoreText}</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderInspectorDrawer(viewingRound) {
    if (!masterState || !inspectedGroupId) return;
    const groupMeta = masterState.groups.find((g) => g.id === inspectedGroupId);
    if (!groupMeta) {
      inspectorDrawer.hidden = true;
      inspectedGroupId = null;
      return;
    }

    const row = viewingRound?.groups.find((g) => g.groupId === inspectedGroupId) || null;
    const masked = shouldMaskValues(viewingRound);
    const isActiveViewing =
      viewingRound && masterState.activeRoundNumber === viewingRound.roundNumber;

    inspectorTitle.textContent = groupMeta.name;
    inspectorPinBadge.textContent = `Team PIN: ${groupMeta.teamCode}`;
    inspectorOnlineBadge.textContent = groupMeta.online
      ? `${groupMeta.connectedDevices} device(s) online`
      : 'Offline';
    inspectorOnlineBadge.className = `badge ${groupMeta.online ? 'badge-success' : ''}`;

    const statusLabel = row ? row.status : 'waiting';
    inspectorStatusBadge.textContent =
      statusLabel === 'submitted' ? 'Submitted' : statusLabel === 'sampling' ? 'Sampling' : 'Waiting';

    inspectorPrivacyNote.hidden = !masked;

    inspectorCount.textContent = row ? String(row.requestedCount) : '0';
    inspectorGuess.textContent =
      !row || row.guess === null ? '—' : masked ? 'Hidden' : formatNum(row.guess);
    inspectorError.textContent =
      !row || row.absError === null ? '—' : masked ? 'Hidden' : formatNum(row.absError);
    inspectorScore.textContent =
      !row || row.score === null ? '—' : masked ? 'Hidden' : formatScore(row.score);

    // Observed sample & estimators
    inspectorSampleSection.hidden = masked;
    if (!masked && row && row.requestedCount > 0) {
      inspectorEstimators.innerHTML = `
        <div class="estimator-tile">
          <span class="stat-label">Sample Max</span>
          <strong class="tabular">${formatNum(row.max)}</strong>
        </div>
        <div class="estimator-tile">
          <span class="stat-label">(n+1)/n · Max</span>
          <strong class="tabular">${row.maxAdjustedEstimate !== null ? row.maxAdjustedEstimate.toFixed(1) : '—'}</strong>
        </div>
        <div class="estimator-tile">
          <span class="stat-label">2·Mean − 1</span>
          <strong class="tabular">${row.momEstimate !== null ? row.momEstimate.toFixed(1) : '—'}</strong>
        </div>
      `;

      inspectorChipsEmpty.hidden = true;
      inspectorChips.innerHTML = row.sortedDraws
        .map((v) => `<span class="chip">${v}</span>`)
        .join('');
    } else if (!masked) {
      inspectorEstimators.innerHTML = '';
      inspectorChips.innerHTML = '';
      inspectorChipsEmpty.hidden = false;
    }

    // Group chronological timeline for viewingRound (or all events for this group)
    const groupEvents = (masterState.events || []).filter(
      (ev) =>
        ev.groupId === inspectedGroupId &&
        (!viewingRound || ev.roundNumber === viewingRound.roundNumber || ev.type === 'joined')
    );

    if (groupEvents.length === 0) {
      inspectorTimeline.innerHTML = '<p class="empty">No decision events recorded yet.</p>';
    } else {
      inspectorTimeline.innerHTML = groupEvents
        .map((ev) => {
          let detail = formatEventDescription(ev, masked);
          if (!masked && ev.type === 'draw' && ev.payload.drawnValues?.length) {
            detail += `<div class="small" style="margin-top:0.25rem;">Drew: ${ev.payload.drawnValues.join(', ')} (range ${ev.payload.minAfter}–${ev.payload.maxAfter})</div>`;
          }
          return `
            <div class="timeline-item">
              <span class="activity-time">${escapeHtml(formatTime(ev.timestamp))}</span>
              ${detail}
            </div>
          `;
        })
        .join('');
    }

    inspectorUnlockBtn.disabled = !(
      isActiveViewing &&
      viewingRound?.status !== 'revealed' &&
      row?.guess !== null
    );
  }

  // Master actions
  function handleStartRound() {
    if (!socket) return;
    const proposedK = Number.parseInt(secretKBuffer, 10);
    if (!Number.isInteger(proposedK) || proposedK < 2) {
      showToast('Please type a whole number K of at least 2.', 'error');
      kInput.focus();
      return;
    }

    startRoundBtn.disabled = true;
    socket.emit(
      'master:start_round',
      { secretK: proposedK },
      (res) => {
        startRoundBtn.disabled = false;
        if (!res || !res.ok) {
          showToast(res?.error || 'Could not start round.', 'error');
          return;
        }
        secretKBuffer = '';
        syncMaskedKInput();
        showToast(`Round ${res.roundNumber} started! Students can now draw numbers.`, 'success');
      }
    );
  }

  function handleSetStatus(nextStatus) {
    if (!socket) return;
    socket.emit('master:set_status', { status: nextStatus }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Could not update round status.', 'error');
        return;
      }
      const msgMap = {
        locked: 'Submissions locked.',
        active: 'Submissions reopened.',
        revealed: 'Hidden K and scores revealed to all groups!',
      };
      showToast(msgMap[nextStatus] || 'Round updated.', 'success');
    });
  }

  function handleUnlockGroup(groupId, groupName) {
    if (!socket) return;
    if (!window.confirm(`Unlock ${groupName}'s guess so they can revise it?`)) return;
    socket.emit('master:unlock_group', { groupId }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Could not unlock group.', 'error');
        return;
      }
      showToast(`Unlocked ${groupName}.`, 'success');
    });
  }

  function handleRemoveGroup(groupId, groupName) {
    if (!socket) return;
    if (!window.confirm(`Remove "${groupName}" from this room?`)) return;
    socket.emit('master:remove_group', { groupId }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Could not remove group.', 'error');
        return;
      }
      inspectedGroupId = null;
      inspectorDrawer.hidden = true;
      showToast(`Removed ${groupName}.`, 'success');
    });
  }

  // Button bindings
  startRoundBtn.addEventListener('click', handleStartRound);

  lockToggleBtn.addEventListener('click', () => {
    const activeRound = getActiveRound();
    if (!activeRound) return;
    handleSetStatus(activeRound.status === 'active' ? 'locked' : 'active');
  });

  revealKBtn.addEventListener('click', () => handleSetStatus('revealed'));
  hideKBtn.addEventListener('click', () => handleSetStatus('locked'));

  copyLinkBtn.addEventListener('click', () => copyText(joinUrl(), 'Student join link copied!'));
  qrCopyBtn.addEventListener('click', () => copyText(joinUrl(), 'Student join link copied!'));
  copyHostKeyBtn.addEventListener('click', () => copyText(hostSecret, 'Instructor key copied!'));
  hostKeyChip.addEventListener('click', () => copyText(hostSecret, 'Instructor key copied!'));

  // QR Modal
  showQrBtn.addEventListener('click', async () => {
    qrRoomCodeBig.textContent = roomCode;
    qrJoinUrlEl.textContent = joinUrl();
    qrSvgContainer.innerHTML = '<p class="small">Loading QR…</p>';
    qrModal.hidden = false;
    try {
      const qrEndpoint = apiUrl(
        `/api/sessions/${encodeURIComponent(roomCode)}/qr?appOrigin=${encodeURIComponent(window.location.origin)}`
      );
      const res = await fetch(qrEndpoint);
      if (!res.ok) throw new Error('Failed to load QR code.');
      qrSvgContainer.innerHTML = await res.text();
    } catch (err) {
      qrSvgContainer.innerHTML = `<p class="small">${escapeHtml(err.message)}</p>`;
    }
  });

  qrCloseBtn.addEventListener('click', () => {
    qrModal.hidden = true;
  });
  qrModal.addEventListener('click', (event) => {
    if (event.target === qrModal) qrModal.hidden = true;
  });

  // Inspector drawer bindings
  inspectorCloseBtn.addEventListener('click', () => {
    inspectorDrawer.hidden = true;
    inspectedGroupId = null;
  });
  inspectorDrawer.addEventListener('click', (event) => {
    if (event.target === inspectorDrawer) {
      inspectorDrawer.hidden = true;
      inspectedGroupId = null;
    }
  });
  inspectorUnlockBtn.addEventListener('click', () => {
    if (!inspectedGroupId || !masterState) return;
    const g = masterState.groups.find((x) => x.id === inspectedGroupId);
    if (g) handleUnlockGroup(g.id, g.name);
  });
  inspectorRemoveBtn.addEventListener('click', () => {
    if (!inspectedGroupId || !masterState) return;
    const g = masterState.groups.find((x) => x.id === inspectedGroupId);
    if (g) handleRemoveGroup(g.id, g.name);
  });

  // CSV Exports
  function triggerCsvDownload(endpoint) {
    if (!hostSecret) return;
    const viewingRound = getViewingRound();
    const roundQuery = viewingRound ? `&round=${viewingRound.roundNumber}` : '';
    const url = apiUrl(
      `/api/sessions/${encodeURIComponent(roomCode)}/export/${endpoint}?hostSecret=${encodeURIComponent(hostSecret)}${roundQuery}`
    );
    window.location.href = url;
  }

  exportSummaryBtn.addEventListener('click', () => triggerCsvDownload('summary.csv'));
  exportEventsBtn.addEventListener('click', () => triggerCsvDownload('events.csv'));

  // Auth gate submit
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    authError.hidden = true;
    const key = authInput.value.trim();
    if (!key) return;
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}/verify-host`, {
        method: 'POST',
        body: JSON.stringify({ hostSecret: key }),
      });
      connectMasterSocket(key);
    } catch (err) {
      authError.hidden = false;
      authError.textContent = err.message;
    }
  });

  // Init
  async function init() {
    if (!roomCode) {
      window.location.href = '/';
      return;
    }
    masterRoomCodeEl.textContent = `ROOM ${roomCode}`;
    emptyRoomCode.textContent = roomCode;
    authGateRoom.textContent = roomCode;
    document.title = `Master · Room ${roomCode} — Guess the Hidden K`;

    // Verify room exists
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}`);
    } catch {
      authGate.hidden = false;
      authError.hidden = false;
      authError.textContent = `Room ${roomCode} was not found. Create a new session from the home page.`;
      setConnStatus(false, 'Not found');
      return;
    }

    const savedKey = getMasterKey(roomCode);
    if (savedKey) {
      connectMasterSocket(savedKey);
    } else {
      authGate.hidden = false;
      setConnStatus(false, 'Key required');
    }
  }

  init();
})();
