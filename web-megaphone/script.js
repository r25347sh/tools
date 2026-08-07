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
  let highpassNode    = null;
  let gateGainNode    = null;   // noise gate
  let gainNode        = null;   // user gain
  let compressorNode  = null;
  let analyserNode    = null;
  let isRunning       = false;
  let isMuted         = false;
  let animationId     = null;
  let previousGain    = 1.2;
  let gateThreshold   = 0.02;   // 0~1, lower = more open

  // ========== Visualizer Config ==========
  const BAR_COUNT = 48;
  const SMOOTHING = 0.72;

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

      // 2. getUserMedia
      // autoGainControl は「むら」の原因になりやすいので OFF
      // echoCancellation / noiseSuppression は ON のまま
      const constraints = {
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: false,          // 重要：むら対策
          channelCount: 1,
          sampleRate: { ideal: 48000 }
        },
        video: false
      };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // 3. Create nodes
      sourceNode     = audioContext.createMediaStreamSource(mediaStream);
      highpassNode   = audioContext.createBiquadFilter();
      gateGainNode   = audioContext.createGain();
      gainNode       = audioContext.createGain();
      compressorNode = audioContext.createDynamicsCompressor();
      analyserNode   = audioContext.createAnalyser();

      // --- Highpass: 低域の回り込み・振動をカット（ハウリング対策） ---
      highpassNode.type = 'highpass';
      highpassNode.frequency.value = 90;   // 90Hz以下を落とす
      highpassNode.Q.value = 0.7;

      // --- Noise Gate (簡易) ---
      gateGainNode.gain.value = 0;         // 最初は閉じておく

      // --- User Gain ---
      const userGain = parseFloat(gainSlider.value);
      gainNode.gain.value = isMuted ? 0 : userGain;

      // --- Compressor: 入力のむらを均す ---
      compressorNode.threshold.value = -28;  // dB
      compressorNode.knee.value      = 12;
      compressorNode.ratio.value     = 6;
      compressorNode.attack.value    = 0.005;
      compressorNode.release.value   = 0.18;

      // Analyser
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = SMOOTHING;

      // 4. Connect graph
      // Mic → Highpass → Gate → UserGain → Compressor → Analyser → Speakers
      sourceNode.connect(highpassNode);
      highpassNode.connect(gateGainNode);
      gateGainNode.connect(gainNode);
      gainNode.connect(compressorNode);
      compressorNode.connect(analyserNode);
      analyserNode.connect(audioContext.destination);

      isRunning = true;
      updateUIRunning(true);
      startVisualizer();   // ゲート制御もここで回す

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

    // Disconnect and clean up all nodes
    [sourceNode, highpassNode, gateGainNode, gainNode, compressorNode, analyserNode]
      .forEach(node => {
        if (node) {
          try { node.disconnect(); } catch (_) {}
        }
      });

    sourceNode = highpassNode = gateGainNode = gainNode = compressorNode = analyserNode = null;

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

  // ========== Visualizer + Noise Gate ==========
  function startVisualizer() {
    const bufferLength = analyserNode.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(analyserNode.fftSize);

    // ゲート用スムージング
    let smoothedLevel = 0;

    function draw() {
      if (!isRunning || !analyserNode) return;

      animationId = requestAnimationFrame(draw);

      // 周波数データ（見た目用）
      analyserNode.getByteFrequencyData(freqData);

      // 時間領域データ（ゲート判定用・より正確）
      analyserNode.getByteTimeDomainData(timeData);

      // RMS レベル計算（むらに強い）
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);

      // スムージング
      smoothedLevel = smoothedLevel * 0.82 + rms * 0.18;

      // --- Noise Gate ---
      // 閾値を超えたら開ける。ヒステリシスでチャタリング防止
      if (gateGainNode && !isMuted) {
        const open = smoothedLevel > gateThreshold;
        const target = open ? 1 : 0;
        // 攻撃は速く、リリースは少しゆっくり
        const timeConst = open ? 0.015 : 0.08;
        gateGainNode.gain.setTargetAtTime(target, audioContext.currentTime, timeConst);
      }

      // 表示用レベル（0-100%）
      const levelPercent = Math.min(100, Math.round(smoothedLevel * 280));
      levelValue.textContent = levelPercent + '%';
      meterFill.style.width = levelPercent + '%';

      // --- Draw bars ---
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const barWidth = width / BAR_COUNT;
      const gap = 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // subtle grid
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let i = 0; i < 4; i++) {
        const y = height * (i + 1) / 5;
        ctx.fillRect(0, y, width, 1);
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        // 声帯域寄りにマッピング
        const dataIndex = Math.floor(i * (bufferLength * 0.55) / BAR_COUNT);
        const value = freqData[dataIndex] / 255;
        const barHeight = Math.max(1, value * height * 0.88);

        let color;
        if (value > 0.72) {
          color = `rgba(239, 68, 68, ${0.75 + value * 0.25})`;
        } else if (value > 0.42) {
          color = `rgba(245, 158, 11, ${0.6 + value * 0.3})`;
        } else {
          color = `rgba(34, 197, 94, ${0.35 + value * 0.5})`;
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
    gainSlider.value = 1.2;
    updateGainDisplay(1.2);

    if (gainNode && !isMuted) {
      gainNode.gain.cancelScheduledValues(audioContext.currentTime);
      gainNode.gain.setTargetAtTime(1.2, audioContext.currentTime, 0.05);
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
