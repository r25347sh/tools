/**
 * Web拡声器 - High Performance Audio Amplifier
 * Web Audio API + getUserMedia
 */

(() => {
  'use strict';

  // ========== DOM References ==========
  const $ = (id) => document.getElementById(id);

  const toggleBtn     = $('toggleBtn');
  const btnIcon       = $('btnIcon');
  const btnLabel      = $('btnLabel');
  const muteBtn       = $('muteBtn');
  const muteIcon      = $('muteIcon');
  const resetBtn      = $('resetBtn');
  const gainSlider    = $('gainSlider');
  const gainValue     = $('gainValue');
  const statusIndicator = $('statusIndicator');
  const statusText    = $('statusText');
  const levelValue    = $('levelValue');
  const meterFill     = $('meterFill');
  const canvas        = $('visualizer');
  const ctx           = canvas.getContext('2d');

  // ========== Audio State ==========
  let audioContext    = null;
  let mediaStream     = null;
  let sourceNode      = null;
  let gainNode        = null;
  let analyserNode    = null;
  let isRunning       = false;
  let isMuted         = false;
  let animationId     = null;
  let previousGain    = 1.5;

  // ========== Visualizer Config ==========
  const BAR_COUNT = 48;
  const SMOOTHING = 0.75;

  // ========== Utility ==========
  function setStatus(state, text) {
    statusIndicator.className = 'status-indicator ' + state;
    statusText.textContent = text;
  }

  function updateGainDisplay(value) {
    gainValue.textContent = Number(value).toFixed(1) + 'x';
  }

  // ========== Audio Pipeline ==========
  async function startAmplifier() {
    try {
      // 1. AudioContext
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // 2. getUserMedia with strong echo cancellation
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000
        },
        video: false
      };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // 3. Create nodes
      sourceNode  = audioContext.createMediaStreamSource(mediaStream);
      gainNode    = audioContext.createGain();
      analyserNode = audioContext.createAnalyser();

      // Analyser settings (balance quality vs performance)
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = SMOOTHING;

      // 4. Connect: Mic → Gain → Analyser → Speakers
      sourceNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(audioContext.destination);

      // 5. Apply current gain
      const gain = parseFloat(gainSlider.value);
      gainNode.gain.setValueAtTime(isMuted ? 0 : gain, audioContext.currentTime);

      isRunning = true;
      updateUIRunning(true);
      startVisualizer();

      setStatus('active', '拡声中');
    } catch (err) {
      console.error('Microphone access failed:', err);
      handleError(err);
    }
  }

  function stopAmplifier() {
    // Stop animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // Disconnect and clean up
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }
    if (analyserNode) {
      analyserNode.disconnect();
      analyserNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
      audioContext = null;
    }

    isRunning = false;
    isMuted = false;
    updateUIRunning(false);
    updateMuteUI(false);
    clearVisualizer();
    setStatus('', '待機中');
    levelValue.textContent = '0%';
    meterFill.style.width = '0%';
  }

  // ========== Visualizer ==========
  function startVisualizer() {
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      if (!isRunning || !analyserNode) return;

      animationId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      // Calculate average level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const levelPercent = Math.min(100, Math.round((average / 255) * 140));

      levelValue.textContent = levelPercent + '%';
      meterFill.style.width = levelPercent + '%';

      // Logical size (CSS pixels)
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const barWidth = width / BAR_COUNT;
      const gap = 2;

      // Clear using actual buffer size
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background subtle grid
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      for (let i = 0; i < 4; i++) {
        const y = height * (i + 1) / 5;
        ctx.fillRect(0, y, width, 1);
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        // Focus on lower-mid frequencies (voice range)
        const dataIndex = Math.floor(i * (bufferLength * 0.6) / BAR_COUNT);
        const value = dataArray[dataIndex] / 255;
        const barHeight = Math.max(1, value * height * 0.9);

        let color;
        if (value > 0.75) {
          color = `rgba(239, 68, 68, ${0.7 + value * 0.3})`;
        } else if (value > 0.45) {
          color = `rgba(245, 158, 11, ${0.6 + value * 0.3})`;
        } else {
          color = `rgba(34, 197, 94, ${0.4 + value * 0.5})`;
        }

        ctx.fillStyle = color;
        const x = i * barWidth;
        const y = height - barHeight;
        const w = Math.max(1, barWidth - gap);

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, w, barHeight, [3, 3, 0, 0]);
        } else {
          ctx.rect(x, y, w, barHeight);
        }
        ctx.fill();
      }
    }

    draw();
  }

  function clearVisualizer() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ========== UI Updates ==========
  function updateUIRunning(running) {
    if (running) {
      toggleBtn.classList.add('active');
      btnIcon.textContent = '■';
      btnLabel.textContent = '拡声停止';
    } else {
      toggleBtn.classList.remove('active');
      btnIcon.textContent = '▶';
      btnLabel.textContent = '拡声開始';
    }
  }

  function updateMuteUI(muted) {
    if (muted) {
      muteBtn.classList.add('active');
      muteIcon.textContent = '🔇';
      setStatus('muted', 'ミュート中');
    } else {
      muteBtn.classList.remove('active');
      muteIcon.textContent = '🔊';
      if (isRunning) setStatus('active', '拡声中');
    }
  }

  function handleError(err) {
    let message = 'エラーが発生しました';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      message = 'マイクの使用が拒否されました。ブラウザの設定を確認してください。';
    } else if (err.name === 'NotFoundError') {
      message = 'マイクが見つかりません。';
    } else if (err.name === 'NotReadableError') {
      message = 'マイクが他のアプリで使用中です。';
    }
    setStatus('', message);
    alert(message);
  }

  // ========== Event Handlers ==========
  toggleBtn.addEventListener('click', async () => {
    if (isRunning) {
      stopAmplifier();
    } else {
      // Resume AudioContext if suspended (browser autoplay policy)
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      await startAmplifier();
    }
  });

  muteBtn.addEventListener('click', () => {
    if (!isRunning || !gainNode) return;

    isMuted = !isMuted;
    const targetGain = isMuted ? 0 : parseFloat(gainSlider.value);

    // Smooth mute/unmute
    gainNode.gain.cancelScheduledValues(audioContext.currentTime);
    gainNode.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.03);

    updateMuteUI(isMuted);
  });

  resetBtn.addEventListener('click', () => {
    gainSlider.value = 1.5;
    updateGainDisplay(1.5);

    if (gainNode && !isMuted) {
      gainNode.gain.cancelScheduledValues(audioContext.currentTime);
      gainNode.gain.setTargetAtTime(1.5, audioContext.currentTime, 0.05);
    }
  });

  gainSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    updateGainDisplay(value);

    if (gainNode && !isMuted) {
      // Smooth gain change
      gainNode.gain.cancelScheduledValues(audioContext.currentTime);
      gainNode.gain.setTargetAtTime(value, audioContext.currentTime, 0.03);
    }
  });

  // Prevent page unload while running (optional safety)
  window.addEventListener('beforeunload', () => {
    if (isRunning) stopAmplifier();
  });

  // Handle visibility change (save battery / prevent feedback when tab hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning && gainNode) {
      // Soft mute when tab is hidden
      previousGain = parseFloat(gainSlider.value);
      gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
    } else if (!document.hidden && isRunning && gainNode && !isMuted) {
      gainNode.gain.setTargetAtTime(previousGain, audioContext.currentTime, 0.05);
    }
  });

  // ========== Init ==========
  updateGainDisplay(gainSlider.value);

  // High-DPI canvas setup
  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing operations
  }

  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  // Feature detection
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('', 'このブラウザはマイクに対応していません');
    toggleBtn.disabled = true;
    toggleBtn.style.opacity = '0.5';
  }
})();
