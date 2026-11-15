import jsQR from 'jsqr';
import { parseChunk, reconstructData, recoverFountainSlice } from './compress';

export class Receiver {
  constructor() {
    this.stream = null;
    this.isDecoding = false;
    this.animationFrameId = null;

    // Session State
    this.currentSessionId = null;
    this.totalChunks = 0;
    this.filename = '';
    this.chunksReceived = {}; // Key: Index, Value: payload
    this.repairPool = []; // Unresolved Fountain Repair packets
    this.fountainRecoveredCount = 0;
    this.isFinished = false;

    // DOM Elements
    this.video = document.getElementById('camera-video');
    this.canvas = document.getElementById('camera-canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.cameraSelect = document.getElementById('camera-select');
    this.btnToggleMirror = document.getElementById('btn-toggle-mirror');
    this.btnToggleCamera = document.getElementById('btn-toggle-camera');
    this.zoomSlider = document.getElementById('camera-zoom-slider');
    this.zoomValueLabel = document.getElementById('zoom-value-label');
    this.focusControlContainer = document.getElementById('focus-control-container');
    this.focusSlider = document.getElementById('camera-focus-slider');
    this.focusValueLabel = document.getElementById('focus-value-label');
    this.btnToggleFocusLock = document.getElementById('btn-toggle-focus-lock');
    this.btnToggleContrast = document.getElementById('btn-toggle-contrast');
    
    this.isMirrored = false;
    this.zoomLevel = 1.0;
    this.focusLocked = false;
    this.contrastBoost = true;
    this.isTickBusy = false;

    // Initialize native hardware-accelerated BarcodeDetector when supported
    this.barcodeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        this.barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        this.barcodeDetector = null;
      }
    }
    
    this.progressPanel = document.getElementById('receive-progress-panel');
    this.fileInfoText = document.getElementById('recv-file-info');
    this.percentageText = document.getElementById('recv-percentage');
    this.progressBar = document.getElementById('recv-progress-bar');
    this.missingChunksBanner = document.getElementById('missing-chunks-banner');
    this.chunksGrid = document.getElementById('chunks-grid');
    this.chunkInfoLabel = document.getElementById('chunk-info-label');
    
    this.resultCard = document.getElementById('result-card');
    this.resultTitle = document.getElementById('result-title');
    this.resultDetails = document.getElementById('result-details');
    this.btnDownloadResult = document.getElementById('btn-download-result');
    this.btnCopyResult = document.getElementById('btn-copy-result');
    this.btnResetRecv = document.getElementById('btn-reset-recv');
    
    this.downloadBlobUrl = null;
    this.decryptedText = null;

    this.camerasDetected = false;

    this.initEventListeners();
  }

  initEventListeners() {
    this.btnToggleMirror?.addEventListener('click', () => this.toggleMirror());
    this.btnToggleCamera.addEventListener('click', () => this.toggleCamera());
    this.cameraSelect.addEventListener('change', () => {
      if (this.stream) {
        this.stopCamera();
        this.startCamera();
      }
    });

    this.zoomSlider?.addEventListener('input', (e) => {
      this.zoomLevel = parseFloat(e.target.value) || 1.0;
      if (this.zoomValueLabel) {
        this.zoomValueLabel.textContent = `${this.zoomLevel.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1')}x`;
      }
      this.applyVideoTransform();
      this.applyHardwareZoom();
    });

    this.focusSlider?.addEventListener('input', (e) => {
      const dist = parseFloat(e.target.value);
      this.applyManualFocusDistance(dist);
    });

    this.btnToggleFocusLock?.addEventListener('click', () => {
      this.setFocusLock(!this.focusLocked);
    });

    this.video?.addEventListener('click', () => {
      if (this.stream) {
        this.setFocusLock(!this.focusLocked);
      }
    });

    this.btnToggleContrast?.addEventListener('click', () => {
      this.contrastBoost = !this.contrastBoost;
      this.btnToggleContrast.textContent = `Anti-Glare: ${this.contrastBoost ? 'ON' : 'OFF'}`;
      if (this.contrastBoost) {
        this.btnToggleContrast.classList.add('btn-primary');
      } else {
        this.btnToggleContrast.classList.remove('btn-primary');
      }
    });
    
    this.btnResetRecv.addEventListener('click', () => this.resetReceiver());
    this.btnDownloadResult.addEventListener('click', () => this.downloadFile());
    this.btnCopyResult.addEventListener('click', () => this.copyToClipboard());
  }

  async detectCameras() {
    try {
      // Prompt permission first to get device labels, then immediately release the temporary stream
      // so the webcam hardware isn't locked at default 640x480 resolution.
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      tempStream.getTracks().forEach(track => track.stop());

      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      this.cameraSelect.innerHTML = '';
      
      if (videoDevices.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No cameras found';
        this.cameraSelect.appendChild(option);
        return;
      }
      
      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1}`;
        // Prioritize back camera on mobile devices
        if (device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('environment')) {
          option.selected = true;
        }
        this.cameraSelect.appendChild(option);
      });
    } catch (err) {
      console.error('Error enumerating cameras:', err);
      this.cameraSelect.innerHTML = '<option value="">Permission denied / No Camera</option>';
    }
  }

  applyVideoTransform() {
    const scaleX = this.isMirrored ? -this.zoomLevel : this.zoomLevel;
    const scaleY = this.zoomLevel;
    this.video.style.transform = `scale(${scaleX}, ${scaleY})`;
  }

  applyHardwareZoom() {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    try {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        const targetZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, this.zoomLevel));
        track.applyConstraints({ advanced: [{ zoom: targetZoom }] }).catch(() => {});
      }
    } catch (e) {
      // Ignore if hardware zoom is unsupported
    }
  }

  setupFocusControls() {
    this.focusLocked = false;
    this.updateFocusLockUI();

    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    try {
      const caps = track.getCapabilities();
      const settings = track.getSettings ? track.getSettings() : {};

      // Restore continuous autofocus & auto-exposure by default so the camera focuses itself automatically
      const advanced = {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        advanced.focusMode = 'continuous';
      }
      if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
        advanced.exposureMode = 'continuous';
      }
      if (Object.keys(advanced).length > 0) {
        track.applyConstraints({ advanced: [advanced] }).catch(() => {});
      }

      if (caps.focusDistance && this.focusControlContainer && this.focusSlider) {
        this.focusControlContainer.classList.remove('hidden');
        this.focusSlider.min = caps.focusDistance.min;
        this.focusSlider.max = caps.focusDistance.max;
        this.focusSlider.step = caps.focusDistance.step || ((caps.focusDistance.max - caps.focusDistance.min) / 100);
        if (settings.focusDistance !== undefined) {
          this.focusSlider.value = settings.focusDistance;
        }
        if (this.focusValueLabel) {
          this.focusValueLabel.textContent = 'Auto';
        }
      } else if (this.focusControlContainer) {
        this.focusControlContainer.classList.add('hidden');
      }
    } catch (e) {
      // Ignore capability inspection errors
    }
  }

  applyManualFocusDistance(distance) {
    if (!this.stream || isNaN(distance)) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    try {
      const caps = track.getCapabilities();
      if (caps.focusMode && caps.focusMode.includes('manual')) {
        const clamped = caps.focusDistance
          ? Math.min(caps.focusDistance.max, Math.max(caps.focusDistance.min, distance))
          : distance;
        track.applyConstraints({
          advanced: [{ focusMode: 'manual', focusDistance: clamped }]
        }).catch(() => {});
        this.focusLocked = true;
        if (this.focusValueLabel) {
          this.focusValueLabel.textContent = `${Math.round(clamped)}`;
        }
        this.updateFocusLockUI();
      }
    } catch (e) {
      // Ignore manual focus errors
    }
  }

  setFocusLock(locked) {
    this.focusLocked = locked;
    this.updateFocusLockUI();

    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    try {
      const caps = track.getCapabilities();
      const settings = track.getSettings ? track.getSettings() : {};

      if (locked) {
        const adv = {};
        if (caps.focusMode && caps.focusMode.includes('manual')) {
          adv.focusMode = 'manual';
          if (caps.focusDistance && settings.focusDistance !== undefined) {
            adv.focusDistance = settings.focusDistance;
            if (this.focusSlider) this.focusSlider.value = settings.focusDistance;
            if (this.focusValueLabel) this.focusValueLabel.textContent = 'Locked';
          }
        } else if (caps.focusMode && caps.focusMode.includes('single-shot')) {
          adv.focusMode = 'single-shot';
        }
        if (caps.exposureMode && caps.exposureMode.includes('manual')) {
          adv.exposureMode = 'manual';
        }
        if (Object.keys(adv).length > 0) {
          track.applyConstraints({ advanced: [adv] }).catch(() => {});
        }
      } else {
        const adv = {};
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          adv.focusMode = 'continuous';
        }
        if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
          adv.exposureMode = 'continuous';
        }
        if (this.focusValueLabel) {
          this.focusValueLabel.textContent = 'Auto';
        }
        if (Object.keys(adv).length > 0) {
          track.applyConstraints({ advanced: [adv] }).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore focus lock errors on fixed-focus lenses
    }
  }

  updateFocusLockUI() {
    if (!this.btnToggleFocusLock) return;
    if (this.focusLocked) {
      this.btnToggleFocusLock.textContent = 'Focus: Locked';
      this.btnToggleFocusLock.classList.add('btn-primary');
    } else {
      this.btnToggleFocusLock.textContent = 'Lock Focus';
      this.btnToggleFocusLock.classList.remove('btn-primary');
    }
  }
  toggleMirror() {
    this.isMirrored = !this.isMirrored;
    if (this.isMirrored) {
      if (this.btnToggleMirror) this.btnToggleMirror.classList.add('btn-primary');
    } else {
      if (this.btnToggleMirror) this.btnToggleMirror.classList.remove('btn-primary');
    }
    this.applyVideoTransform();
  }

  async toggleCamera() {
    if (this.stream) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  async startCamera() {
    if (!this.camerasDetected) {
      await this.detectCameras();
      this.camerasDetected = true;
    }

    const deviceId = this.cameraSelect.value;
    // Request 1080p HD so fixed-focus computer webcams resolve fine QR modules from 1-2 ft away
    const videoConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = { ideal: 'environment' };
    }
    
    // Auto-detect front camera (selfie camera) and auto-mirror
    const selectedOption = this.cameraSelect.options[this.cameraSelect.selectedIndex];
    const label = selectedOption ? selectedOption.textContent.toLowerCase() : '';
    if (label.includes('front') || label.includes('user') || label.includes('facetime') || label.includes('integrated') || label.includes('webcam')) {
      this.isMirrored = true;
      if (this.btnToggleMirror) this.btnToggleMirror.classList.add('btn-primary');
    } else if (label.includes('back') || label.includes('environment')) {
      this.isMirrored = false;
      if (this.btnToggleMirror) this.btnToggleMirror.classList.remove('btn-primary');
    }
    this.applyVideoTransform();
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      this.setupFocusControls();
      this.applyHardwareZoom();

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', true); // critical for iOS
      this.video.play();
      
      this.btnToggleCamera.textContent = 'Stop Camera';
      this.btnToggleCamera.classList.remove('btn-secondary');
      this.btnToggleCamera.classList.add('btn-outline');
      
      this.isDecoding = true;
      this.video.onloadedmetadata = () => {
        this.canvas.width = this.video.videoWidth || 1280;
        this.canvas.height = this.video.videoHeight || 720;
        this.tick();
      };
    } catch (err) {
      console.error('Camera open failed:', err);
      alert('Could not start camera. Check permissions and try again.');
    }
  }

  stopCamera() {
    this.isDecoding = false;
    this.isTickBusy = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    this.video.srcObject = null;
    this.btnToggleCamera.textContent = 'Start Camera';
    this.btnToggleCamera.classList.remove('btn-outline');
    this.btnToggleCamera.classList.add('btn-secondary');
  }

  drawZoomedFrameToCanvas() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return false;

    const cropW = vw / this.zoomLevel;
    const cropH = vh / this.zoomLevel;
    const cropX = (vw - cropW) / 2;
    const cropY = (vh - cropH) / 2;

    // Keep processing canvas capped around 1280px wide for fast decoding while preserving crispness
    const targetW = Math.min(1280, Math.round(cropW));
    const targetH = Math.min(960, Math.round(cropH));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this.ctx.drawImage(this.video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
    return true;
  }

  applyAntiGlareContrast(imageData) {
    const data = imageData.data;
    const len = data.length;

    // Compute luminance histogram min/max (ignoring extreme 1% outliers)
    let sum = 0;
    const pixelCount = len >> 2;
    for (let i = 0; i < len; i += 16) {
      sum += (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
    const avgLuma = sum / (pixelCount >> 2);
    // Phone screens have bright backgrounds; threshold slightly below local average to recover washed-out dark modules
    const threshold = Math.min(210, Math.max(90, avgLuma * 0.92));

    for (let i = 0; i < len; i += 4) {
      const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      // High-slope contrast stretch centered around threshold
      const stretched = Math.min(255, Math.max(0, ((luma - threshold) * 3.2) + 128));
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }
  }

  scanWithJsQR(useContrastBoost = false) {
    let foundCount = 0;
    const maxQRsPerFrame = 4;

    while (foundCount < maxQRsPerFrame) {
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      if (useContrastBoost) {
        this.applyAntiGlareContrast(imageData);
      }

      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data) {
        this.handleDecodedQR(code.data);
        foundCount++;

        // Redact the scanned QR code area with a white polygon to find any adjacent QR codes
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.moveTo(code.location.topLeftCorner.x, code.location.topLeftCorner.y);
        this.ctx.lineTo(code.location.topRightCorner.x, code.location.topRightCorner.y);
        this.ctx.lineTo(code.location.bottomRightCorner.x, code.location.bottomRightCorner.y);
        this.ctx.lineTo(code.location.bottomLeftCorner.x, code.location.bottomLeftCorner.y);
        this.ctx.closePath();
        this.ctx.fill();
      } else {
        break;
      }
    }

    return foundCount;
  }

  async tick() {
    if (!this.isDecoding) return;
    if (this.isTickBusy) {
      this.animationFrameId = requestAnimationFrame(() => this.tick());
      return;
    }

    this.isTickBusy = true;
    try {
      if (this.video.readyState === this.video.HAVE_ENOUGH_DATA && this.drawZoomedFrameToCanvas()) {
        let detected = 0;

        // 1. Try native hardware-accelerated BarcodeDetector first (handles blur, glare, and multi-QR best)
        if (this.barcodeDetector) {
          try {
            const barcodes = await this.barcodeDetector.detect(this.canvas);
            for (const barcode of barcodes) {
              if (barcode.rawValue) {
                this.handleDecodedQR(barcode.rawValue);
                detected++;
              }
            }
          } catch (e) {
            // Fallback to jsQR if BarcodeDetector fails
          }
        }

        // 2. Fallback to jsQR (normal pass, then anti-glare contrast-boosted pass if enabled)
        if (detected === 0 && this.isDecoding) {
          detected = this.scanWithJsQR(false);
          if (detected === 0 && this.contrastBoost && this.isDecoding) {
            this.drawZoomedFrameToCanvas();
            this.scanWithJsQR(true);
          }
        }
      }
    } finally {
      this.isTickBusy = false;
    }

    if (this.isDecoding) {
      this.animationFrameId = requestAnimationFrame(() => this.tick());
    }
  }

  handleDecodedQR(data) {
    const chunk = parseChunk(data);
    if (!chunk) return; // Not a valid chunk for our app
    
    // Check if this is a new transfer session
    if (this.currentSessionId !== chunk.sessionId) {
      this.startNewSession(chunk);
    }

    if (chunk.isFountain) {
      const key = chunk.indices.join('-');
      const exists = this.repairPool.some(p => p.key === key);
      if (!exists) {
        this.repairPool.push({
          key,
          indices: chunk.indices,
          lastChunkLen: chunk.lastChunkLen,
          payload: chunk.payload
        });
        this.resolveRepairPool();
      }
    } else if (this.chunksReceived[chunk.index] === undefined) {
      this.chunksReceived[chunk.index] = chunk.payload;
      this.updateProgressUI(chunk.index, false);
      this.resolveRepairPool();
    }

    // Check if we are finished
    if (!this.isFinished && Object.keys(this.chunksReceived).length === this.totalChunks) {
      this.completeTransfer();
    }
  }

  resolveRepairPool() {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = this.repairPool.length - 1; i >= 0; i--) {
        const pkt = this.repairPool[i];
        const missing = pkt.indices.filter(idx => this.chunksReceived[idx] === undefined);

        if (missing.length === 0) {
          this.repairPool.splice(i, 1);
        } else if (missing.length === 1) {
          const targetIdx = missing[0];
          const knownPayloads = pkt.indices
            .filter(idx => idx !== targetIdx)
            .map(idx => this.chunksReceived[idx]);
          const targetLen = (targetIdx === this.totalChunks - 1)
            ? pkt.lastChunkLen
            : pkt.payload.length;

          const recovered = recoverFountainSlice(pkt.payload, knownPayloads, targetLen, this.encoding);
          this.chunksReceived[targetIdx] = recovered;
          this.fountainRecoveredCount++;
          this.repairPool.splice(i, 1);
          this.updateProgressUI(targetIdx, true);
          progress = true;
        }
      }
    }
  }

  startNewSession(chunk) {
    this.currentSessionId = chunk.sessionId;
    this.totalChunks = chunk.total;
    this.filename = chunk.filename;
    this.encoding = chunk.encoding;
    this.chunksReceived = {};
    this.repairPool = [];
    this.fountainRecoveredCount = 0;
    this.isFinished = false;
    
    // Show progress panel
    this.progressPanel.classList.remove('hidden');
    this.fileInfoText.textContent = this.filename === '_clip_' ? 'Clipboard Sharing' : `File: ${this.filename}`;
    
    // Build chunks visual grid
    this.chunksGrid.innerHTML = '';
    for (let i = 0; i < this.totalChunks; i++) {
      const box = document.createElement('div');
      box.className = 'chunk-box';
      box.id = `chunk-box-${i}`;
      box.textContent = `${i + 1}`;
      box.title = `Chunk ${i + 1}: Missing`;
      
      // Interactive hover & click helper
      const updateLabel = () => {
        const received = this.chunksReceived[i] !== undefined;
        this.chunkInfoLabel.textContent = `Chunk #${i + 1}: ${received ? 'Received ✓' : 'Missing ✗'}`;
        this.chunkInfoLabel.style.color = received ? 'var(--success)' : 'var(--error)';
      };
      
      box.addEventListener('mouseenter', updateLabel);
      box.addEventListener('click', updateLabel);
      box.addEventListener('mouseleave', () => {
        this.chunkInfoLabel.textContent = 'Hover/Click a chunk to inspect';
        this.chunkInfoLabel.style.color = 'var(--text-muted)';
      });
      
      this.chunksGrid.appendChild(box);
    }
    
    this.updateProgressUI();
  }

  updateProgressUI(newlyReceivedIndex = null, viaFountain = false) {
    if (newlyReceivedIndex !== null) {
      const box = document.getElementById(`chunk-box-${newlyReceivedIndex}`);
      if (box) {
        box.classList.add('received');
        if (viaFountain) box.classList.add('repaired');
        box.title = `Chunk ${newlyReceivedIndex + 1}: ${viaFountain ? 'Recovered via Fountain Repair ⚡' : 'Received'}`;
      }
    }
    
    const count = Object.keys(this.chunksReceived).length;
    const percentage = Math.round((count / this.totalChunks) * 100);
    const repairSuffix = this.fountainRecoveredCount > 0 ? ` • ⚡${this.fountainRecoveredCount} repaired` : '';
    this.percentageText.textContent = `${percentage}% (${count}/${this.totalChunks}${repairSuffix})`;
    this.progressBar.style.width = `${percentage}%`;

    if (this.missingChunksBanner) {
      const missingIndices = [];
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.chunksReceived[i] === undefined) {
          missingIndices.push(`#${i + 1}`);
        }
      }

      if (missingIndices.length > 0 && count > 0) {
        this.missingChunksBanner.classList.remove('hidden');
        const shown = missingIndices.slice(0, 15).join(', ');
        const more = missingIndices.length > 15 ? ` (+${missingIndices.length - 15} more)` : '';
        this.missingChunksBanner.textContent = `Still needed (${missingIndices.length}): ${shown}${more}`;
      } else {
        this.missingChunksBanner.classList.add('hidden');
      }
    }
  }

  completeTransfer() {
    this.isFinished = true;
    this.stopCamera();
    
    // Hide viewport & progress
    document.querySelector('.scanner-card').classList.add('hidden');
    this.resultCard.classList.remove('hidden');
    
    try {
      // Rebuild and decompress
      const orderedChunks = [];
      for (let i = 0; i < this.totalChunks; i++) {
        orderedChunks.push(this.chunksReceived[i]);
      }
      const decompressedData = reconstructData(orderedChunks, this.encoding);
      
      this.resultDetails.innerHTML = '';
      
      if (this.filename === '_clip_') {
        // Handle text content
        this.decryptedText = new TextDecoder().decode(decompressedData);
        
        this.resultTitle.textContent = 'Clipboard Received!';
        
        const detailRow = document.createElement('div');
        detailRow.className = 'detail-row';
        detailRow.innerHTML = `<span class="detail-label">Type:</span><span class="detail-value">Clipboard Text</span>`;
        this.resultDetails.appendChild(detailRow);
        
        const lengthRow = document.createElement('div');
        lengthRow.className = 'detail-row';
        lengthRow.innerHTML = `<span class="detail-label">Size:</span><span class="detail-value">${this.decryptedText.length} characters</span>`;
        this.resultDetails.appendChild(lengthRow);
        
        const previewContainer = document.createElement('div');
        previewContainer.className = 'text-preview-container';
        previewContainer.innerHTML = `
          <span class="text-preview-label">Preview:</span>
          <div class="text-preview">${this.escapeHTML(this.decryptedText)}</div>
        `;
        this.resultDetails.appendChild(previewContainer);
        
        this.btnCopyResult.classList.remove('hidden');
        this.btnDownloadResult.classList.add('hidden');
        
        // Write automatically to system clipboard if supported
        this.copyToClipboard(true);
      } else {
        // Handle file download
        const blob = new Blob([decompressedData], { type: 'application/octet-stream' });
        this.downloadBlobUrl = URL.createObjectURL(blob);
        
        this.resultTitle.textContent = 'File Received!';
        
        const nameRow = document.createElement('div');
        nameRow.className = 'detail-row';
        nameRow.innerHTML = `<span class="detail-label">Filename:</span><span class="detail-value">${this.filename}</span>`;
        this.resultDetails.appendChild(nameRow);
        
        const sizeRow = document.createElement('div');
        sizeRow.className = 'detail-row';
        sizeRow.innerHTML = `<span class="detail-label">Size:</span><span class="detail-value">${this.formatBytes(decompressedData.length)}</span>`;
        this.resultDetails.appendChild(sizeRow);
        
        this.btnDownloadResult.classList.remove('hidden');
        this.btnCopyResult.classList.add('hidden');
      }
    } catch (err) {
      console.error('Failed to reconstruct transfer:', err);
      this.resultTitle.textContent = 'Decompression Failed';
      this.resultDetails.textContent = 'The received data could not be parsed or decompressed. It is possible the stream was interrupted or QR frames were corrupted.';
      this.btnDownloadResult.classList.add('hidden');
      this.btnCopyResult.classList.add('hidden');
    }
  }

  downloadFile() {
    if (!this.downloadBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.downloadBlobUrl;
    a.download = this.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async copyToClipboard(silent = false) {
    if (!this.decryptedText) return;
    try {
      await navigator.clipboard.writeText(this.decryptedText);
      if (!silent) {
        const origText = this.btnCopyResult.textContent;
        this.btnCopyResult.textContent = 'Copied to Clipboard!';
        this.btnCopyResult.classList.add('btn-primary');
        this.btnCopyResult.classList.remove('btn-secondary');
        setTimeout(() => {
          this.btnCopyResult.textContent = origText;
          this.btnCopyResult.classList.remove('btn-primary');
          this.btnCopyResult.classList.add('btn-secondary');
        }, 2000);
      }
    } catch (err) {
      if (!silent) alert('Could not write to clipboard automatically.');
    }
  }

  resetReceiver() {
    if (this.downloadBlobUrl) {
      URL.revokeObjectURL(this.downloadBlobUrl);
      this.downloadBlobUrl = null;
    }
    this.decryptedText = null;
    this.currentSessionId = null;
    this.chunksReceived = {};
    this.repairPool = [];
    this.fountainRecoveredCount = 0;
    this.totalChunks = 0;
    if (this.missingChunksBanner) {
      this.missingChunksBanner.classList.add('hidden');
    }
    
    this.resultCard.classList.add('hidden');
    document.querySelector('.scanner-card').classList.remove('hidden');
    this.progressPanel.classList.add('hidden');
    
    this.startCamera();
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  escapeHTML(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}
