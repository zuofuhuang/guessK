(function () {
  const {
    normalizeRoomInput,
    apiJson,
    saveMasterSession,
    getMasterSessions,
    getAllStudentSessions,
    escapeHtml,
  } = window.GuessK;

  const studentJoinForm = document.getElementById('student-join-form');
  const joinRoomInput = document.getElementById('join-room-code');
  const studentJoinBtn = document.getElementById('student-join-btn');
  const studentJoinError = document.getElementById('student-join-error');

  const createRoomForm = document.getElementById('create-room-form');
  const hostPasscodeInput = document.getElementById('host-passcode-input');
  const createRoomBtn = document.getElementById('create-room-btn');
  const createRoomError = document.getElementById('create-room-error');

  const reopenRoomForm = document.getElementById('reopen-room-form');
  const reopenRoomInput = document.getElementById('reopen-room-code');
  const reopenHostKeyInput = document.getElementById('reopen-host-key');
  const reopenRoomBtn = document.getElementById('reopen-room-btn');
  const reopenRoomError = document.getElementById('reopen-room-error');

  const savedStudentShortcut = document.getElementById('saved-student-shortcut');
  const savedStudentList = document.getElementById('saved-student-list');
  const recentMasterSection = document.getElementById('recent-master-section');
  const recentMasterList = document.getElementById('recent-master-list');

  function setError(el, msg) {
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
    } else {
      el.hidden = false;
      el.textContent = msg;
    }
  }

  studentJoinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(studentJoinError, '');
    const roomCode = normalizeRoomInput(joinRoomInput.value);
    if (!roomCode) {
      setError(studentJoinError, 'Please enter a valid room code.');
      return;
    }

    studentJoinBtn.disabled = true;
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}`);
      window.location.href = `/play/${encodeURIComponent(roomCode)}`;
    } catch (err) {
      setError(studentJoinError, err.message);
    } finally {
      studentJoinBtn.disabled = false;
    }
  });

  createRoomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(createRoomError, '');
    const passcode = hostPasscodeInput.value.trim();

    createRoomBtn.disabled = true;
    try {
      const data = await apiJson('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      });
      saveMasterSession(data.roomCode, data.hostSecret);
      window.location.href = `/master/${encodeURIComponent(data.roomCode)}`;
    } catch (err) {
      setError(createRoomError, err.message);
    } finally {
      createRoomBtn.disabled = false;
    }
  });

  reopenRoomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(reopenRoomError, '');
    const roomCode = normalizeRoomInput(reopenRoomInput.value);
    const hostSecret = reopenHostKeyInput.value.trim();

    if (!roomCode || !hostSecret) {
      setError(reopenRoomError, 'Enter both the room code and your instructor key or passcode.');
      return;
    }

    reopenRoomBtn.disabled = true;
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(roomCode)}/verify-host`, {
        method: 'POST',
        body: JSON.stringify({ hostSecret }),
      });
      saveMasterSession(roomCode, hostSecret);
      window.location.href = `/master/${encodeURIComponent(roomCode)}`;
    } catch (err) {
      setError(reopenRoomError, err.message);
    } finally {
      reopenRoomBtn.disabled = false;
    }
  });

  function renderSavedShortcuts() {
    const studentList = getAllStudentSessions().slice(0, 4);
    if (studentList.length > 0) {
      savedStudentShortcut.hidden = false;
      savedStudentList.innerHTML = studentList
        .map(
          (item) => `
          <div class="recent-item">
            <div>
              <strong>${escapeHtml(item.groupName)}</strong>
              <span class="badge badge-mono" style="margin-left: 0.4rem;">${escapeHtml(item.roomCode)}</span>
            </div>
            <a class="btn secondary btn-sm" href="/play/${encodeURIComponent(item.roomCode)}">Resume</a>
          </div>
        `
        )
        .join('');
    }

    const masterList = getMasterSessions().slice(0, 5);
    if (masterList.length > 0) {
      recentMasterSection.hidden = false;
      recentMasterList.innerHTML = masterList
        .map(
          (item) => `
          <div class="recent-item">
            <div>
              <span class="badge badge-mono">${escapeHtml(item.roomCode)}</span>
              <span class="small" style="margin-left: 0.5rem;">Saved session</span>
            </div>
            <a class="btn ghost btn-sm" href="/master/${encodeURIComponent(item.roomCode)}">Open Master</a>
          </div>
        `
        )
        .join('');
    }
  }

  renderSavedShortcuts();
})();
