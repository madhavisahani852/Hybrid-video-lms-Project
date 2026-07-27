document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const topicInput = document.getElementById('topicInput');
  const generateScriptBtn = document.getElementById('generateScriptBtn');
  const scriptText = document.getElementById('scriptText');
  const voiceSelect = document.getElementById('voiceSelect');
  const durationSelect = document.getElementById('durationSelect');

  const avatarPrompt = document.getElementById('avatarPrompt');
  const generateAvatarBtn = document.getElementById('generateAvatarBtn');
  const avatarPreviewBox = document.getElementById('avatarPreviewBox');
  const dropzone = document.getElementById('dropzone');
  const avatarFileInput = document.getElementById('avatarFileInput');

  const renderVideoBtn = document.getElementById('renderVideoBtn');
  const progressBox = document.getElementById('progressBox');
  const jobStageText = document.getElementById('jobStageText');
  const jobPercentText = document.getElementById('jobPercentText');
  const progressBarFill = document.getElementById('progressBarFill');

  const videoVault = document.getElementById('videoVault');
  const emptyState = document.getElementById('emptyState');
  const playerContainer = document.getElementById('playerContainer');
  const outputVideoPlayer = document.getElementById('outputVideoPlayer');
  const downloadVideoBtn = document.getElementById('downloadVideoBtn');

  // Modal Settings
  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const geminiKeyInput = document.getElementById('geminiKeyInput');
  const hfTokenInput = document.getElementById('hfTokenInput');
  const colabUrlInput = document.getElementById('colabUrlInput');

  let currentAvatarPath = null;
  let activeJobInterval = null;

  // Load Settings from LocalStorage
  geminiKeyInput.value = localStorage.getItem('GEMINI_API_KEY') || '';
  hfTokenInput.value = localStorage.getItem('HF_TOKEN') || '';
  colabUrlInput.value = localStorage.getItem('COLAB_WORKER_URL') || '';

  // Initialize Voices
  fetchVoices();

  async function fetchVoices() {
    try {
      const res = await fetch('/api/voices');
      const data = await res.json();
      voiceSelect.innerHTML = '';
      for (const [key, label] of Object.entries(data.voices)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = label;
        voiceSelect.appendChild(option);
      }
    } catch (err) {
      console.error('Failed to fetch voices:', err);
    }
  }

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Script Generator
  generateScriptBtn.addEventListener('click', async () => {
    const topic = topicInput.value.trim();
    if (!topic) {
      alert('Please enter a topic for the script!');
      return;
    }

    generateScriptBtn.disabled = true;
    generateScriptBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Writing...';

    try {
      const res = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          durationMinutes: parseFloat(durationSelect.value),
          apiKey: geminiKeyInput.value.trim()
        })
      });
      const data = await res.json();

      if (data.success) {
        scriptText.value = data.scriptText;
        if (data.avatarPrompt) avatarPrompt.value = data.avatarPrompt;
      } else {
        alert(`Script generation error: ${data.error}`);
      }
    } catch (err) {
      alert('Failed to connect to script generator service.');
    } finally {
      generateScriptBtn.disabled = false;
      generateScriptBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Write Script';
    }
  });

  // Avatar Generator
  generateAvatarBtn.addEventListener('click', async () => {
    const prompt = avatarPrompt.value.trim();
    generateAvatarBtn.disabled = true;
    generateAvatarBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering Image...';

    try {
      const res = await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();

      if (data.success) {
        currentAvatarPath = data.imagePath;
        avatarPreviewBox.innerHTML = `<img src="/tmp/${data.filename}?t=${Date.now()}" alt="Avatar Presenter">`;
      } else {
        alert(`Avatar generation error: ${data.error}`);
      }
    } catch (err) {
      alert('Failed to connect to avatar generator service.');
    } finally {
      generateAvatarBtn.disabled = false;
      generateAvatarBtn.innerHTML = '<i class="fa-solid fa-paint-brush"></i> Generate Presenter Image ($0 FLUX)';
    }
  });

  // Custom File Upload
  dropzone.addEventListener('click', () => avatarFileInput.click());
  avatarFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatarFile', file);

    try {
      const res = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        currentAvatarPath = data.imagePath;
        avatarPreviewBox.innerHTML = `<img src="/tmp/${data.filename}" alt="Custom Presenter">`;
      }
    } catch (err) {
      alert('Failed to upload custom avatar image.');
    }
  });

  // Generate Video Pipeline Trigger
  renderVideoBtn.addEventListener('click', async () => {
    const script = scriptText.value.trim();
    if (!script) {
      alert('Please enter or generate a script first!');
      return;
    }

    if (!currentAvatarPath) {
      alert('Please generate or upload an avatar image first!');
      return;
    }

    renderVideoBtn.disabled = true;
    renderVideoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pipeline Running...';

    progressBox.classList.remove('hidden');
    emptyState.classList.add('hidden');
    playerContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptText: script,
          imagePath: currentAvatarPath,
          voice: voiceSelect.value,
          hfToken: hfTokenInput.value.trim(),
          colabUrl: colabUrlInput.value.trim()
        })
      });
      const data = await res.json();

      if (data.success) {
        pollJobStatus(data.jobId);
      } else {
        alert(`Video pipeline error: ${data.error}`);
        resetProgress();
      }
    } catch (err) {
      alert('Failed to start video rendering task.');
      resetProgress();
    }
  });

  // Poll Job Status
  function pollJobStatus(jobId) {
    if (activeJobInterval) clearInterval(activeJobInterval);

    activeJobInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status/${jobId}`);
        const job = await res.json();

        jobStageText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${job.stage}`;
        jobPercentText.textContent = `${job.progress}%`;
        progressBarFill.style.width = `${job.progress}%`;

        if (job.status === 'completed') {
          clearInterval(activeJobInterval);
          progressBox.classList.add('hidden');
          playerContainer.classList.remove('hidden');

          outputVideoPlayer.src = job.finalVideoUrl;
          downloadVideoBtn.href = job.finalVideoUrl;

          renderVideoBtn.disabled = false;
          renderVideoBtn.innerHTML = '<i class="fa-solid fa-film"></i> Generate 1-3 Min Talking Head Video ($0)';
        } else if (job.status === 'failed') {
          clearInterval(activeJobInterval);
          alert(`Video Rendering Failed: ${job.error}`);
          resetProgress();
        }
      } catch (err) {
        console.error('Error polling job status:', err);
      }
    }, 2000);
  }

  function resetProgress() {
    progressBox.classList.add('hidden');
    emptyState.classList.remove('hidden');
    renderVideoBtn.disabled = false;
    renderVideoBtn.innerHTML = '<i class="fa-solid fa-film"></i> Generate 1-3 Min Talking Head Video ($0)';
  }

  // Settings Modal Controls
  openSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

  saveSettingsBtn.addEventListener('click', () => {
    localStorage.setItem('GEMINI_API_KEY', geminiKeyInput.value.trim());
    localStorage.setItem('HF_TOKEN', hfTokenInput.value.trim());
    localStorage.setItem('COLAB_WORKER_URL', colabUrlInput.value.trim());
    settingsModal.classList.add('hidden');
    alert('Settings saved successfully!');
  });
});
