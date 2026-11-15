import QRCode from 'qrcode';
import { prepareChunks, createFountainChunk } from './compress';

export class Sender {
  constructor() {
    this.chunks = [];
    this.currentSessionId = null;
    this.currentIndex = 0;
    this.isPlaying = false;
    this.playInterval = null;
    
    // UI Settings
    this.fps = 8;
    this.chunkSize = 250; // Character capacity per QR code (250 gives large, easy-to-focus modules)
    this.encoding = 'base45'; // Encoding format: base45 or base64
    this.gridSize = 1; // Number of QRs to show simultaneously
    this.antiGlare = true; // Dim white background slightly to prevent webcam exposure blowout
    this.fountainMode = 'smart'; // 'smart' (after pass 1), 'always', or 'off'
    this.eccLevel = 'Q'; // Error correction level: 'L', 'M', 'Q', 'H'
    this.colorMode = 'bw'; // 'bw' (1x) or 'rgb' (3x R/G/B channel multiplexed)
    this.imageOptMode = 'webp800'; // 'webp800', 'webp480', or 'original'
    this.originalFile = null;
    this.originalFileBytes = 0;
    this.selectedChunks = new Set(); // Optional manual subset of chunk indices to loop
    this.completedPasses = 0;
    this.repairCounter = 0;
    this.isShowingRepairStep = false;
    this.filename = '';
    this.rawContent = null; // Can be string (text) or ArrayBuffer (file)

    // DOM Elements
    this.dropzone = document.getElementById('dropzone');
    this.fileInput = document.getElementById('file-input');
    this.textPayload = document.getElementById('text-payload');
    this.btnPaste = document.getElementById('btn-paste-clipboard');
    this.btnGenerate = document.getElementById('btn-generate');
    this.btnCancel = document.getElementById('btn-cancel-send');
    
    this.streamContainer = document.getElementById('sender-stream-container');
    this.qrContainer = document.getElementById('sender-qr-container');
    this.transferTitle = document.getElementById('transfer-title');
    this.compressionStatsBadge = document.getElementById('compression-stats-badge');
    this.chunkIndexIndicator = document.getElementById('chunk-index-indicator');
    this.fpsIndicator = document.getElementById('fps-indicator');
    this.progressBar = document.getElementById('send-progress-bar');
    this.senderChunksGrid = document.getElementById('sender-chunks-grid');
    this.senderFilterLabel = document.getElementById('sender-filter-label');
    this.btnResetSenderFilter = document.getElementById('btn-reset-sender-filter');
    
    this.btnPrev = document.getElementById('btn-prev-chunk');
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.btnNext = document.getElementById('btn-next-chunk');
    this.speedSlider = document.getElementById('speed-slider');
    this.chunkSizeSlider = document.getElementById('chunk-size-slider');
    this.encodingSelect = document.getElementById('encoding-select');
    this.gridSelect = document.getElementById('grid-select');
    this.antiGlareSelect = document.getElementById('antiglare-select');
    this.fountainSelect = document.getElementById('fountain-select');
    this.eccSelect = document.getElementById('ecc-select');
    this.colorModeSelect = document.getElementById('color-mode-select');
    this.imageOptItem = document.getElementById('image-opt-item');
    this.imageOptSelect = document.getElementById('image-opt-select');

    this.initEventListeners();
  }

  initEventListeners() {
    // Dropzone drag & drop
    this.dropzone.addEventListener('click', () => this.fileInput.click());
    
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });

    this.dropzone.addEventListener('dragleave', () => {
      this.dropzone.classList.remove('dragover');
    });

    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.handleFileSelected(files[0]);
      }
    });

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFileSelected(e.target.files[0]);
      }
    });

    // Clipboard pasting
    this.btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        this.textPayload.value = text;
      } catch (err) {
        alert('Could not access clipboard automatically. Please paste using Ctrl+V / Cmd+V directly in the text area.');
      }
    });

    // Generate Stream
    this.btnGenerate.addEventListener('click', () => {
      const text = this.textPayload.value.trim();
      if (!text) {
        alert('Please paste a file or type some text first!');
        return;
      }
      this.originalFile = null;
      this.originalFileBytes = new TextEncoder().encode(text).byteLength;
      if (this.imageOptItem) this.imageOptItem.classList.add('hidden');
      this.filename = '_clip_';
      this.rawContent = text;
      this.startStreaming();
    });

    // Stream Controls
    this.btnCancel.addEventListener('click', () => this.stopStreaming());
    this.btnPlayPause.addEventListener('click', () => this.togglePlay());
    this.btnPrev.addEventListener('click', () => this.prevChunk());
    this.btnNext.addEventListener('click', () => this.nextChunk());
    
    // Settings
    this.speedSlider.addEventListener('input', (e) => {
      this.fps = parseInt(e.target.value, 10);
      this.fpsIndicator.textContent = `${this.fps} FPS`;
      if (this.isPlaying) {
        this.pause();
        this.play();
      }
    });

    this.chunkSizeSlider.addEventListener('input', (e) => {
      this.chunkSize = parseInt(e.target.value, 10);
      // Re-split if content is active
      if (this.rawContent) {
        const wasPlaying = this.isPlaying;
        this.pause();
        this.currentIndex = 0;
        this.generateChunks();
        if (wasPlaying) this.play();
      }
    });

    this.encodingSelect.addEventListener('change', (e) => {
      this.encoding = e.target.value;
      // Re-split if content is active
      if (this.rawContent) {
        const wasPlaying = this.isPlaying;
        this.pause();
        this.currentIndex = 0;
        this.generateChunks();
        if (wasPlaying) this.play();
      }
    });

    this.gridSelect.addEventListener('change', (e) => {
      this.gridSize = parseInt(e.target.value, 10);
      // Re-split if content is active
      if (this.rawContent) {
        const wasPlaying = this.isPlaying;
        this.pause();
        this.currentIndex = 0;
        this.generateChunks();
        if (wasPlaying) this.play();
      }
    });

    this.antiGlareSelect?.addEventListener('change', (e) => {
      this.antiGlare = e.target.value === 'antiglare';
      this.renderCurrentQR();
    });

    this.fountainSelect?.addEventListener('change', (e) => {
      this.fountainMode = e.target.value;
      this.isShowingRepairStep = false;
      this.updateUI();
    });

    this.eccSelect?.addEventListener('change', (e) => {
      this.eccLevel = e.target.value;
      this.updateUI();
    });

    this.colorModeSelect?.addEventListener('change', (e) => {
      this.colorMode = e.target.value;
      this.currentIndex = 0;
      this.isShowingRepairStep = false;
      this.updateUI();
    });

    this.imageOptSelect?.addEventListener('change', async (e) => {
      this.imageOptMode = e.target.value;
      if (this.originalFile) {
        const wasPlaying = this.isPlaying;
        this.pause();
        await this.processSelectedFile(this.originalFile);
        this.generateChunks();
        if (wasPlaying) this.play();
      }
    });

    this.btnResetSenderFilter?.addEventListener('click', () => {
      this.selectedChunks.clear();
      this.currentIndex = 0;
      this.isShowingRepairStep = false;
      this.updateSenderFilterUI();
      this.updateUI();
    });
  }

  getActiveChunkIndices() {
    if (this.selectedChunks.size > 0) {
      return Array.from(this.selectedChunks).sort((a, b) => a - b);
    }
    return this.chunks.map((_, idx) => idx);
  }

  buildSenderGrid() {
    if (!this.senderChunksGrid) return;
    this.senderChunksGrid.innerHTML = '';

    for (let i = 0; i < this.chunks.length; i++) {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'chunk-box sender-chunk-box';
      box.id = `sender-chunk-box-${i}`;
      box.textContent = `${i + 1}`;
      box.title = `Tap to loop only Chunk #${i + 1}`;

      box.addEventListener('click', () => {
        if (this.selectedChunks.has(i)) {
          this.selectedChunks.delete(i);
        } else {
          this.selectedChunks.add(i);
        }
        this.currentIndex = 0;
        this.isShowingRepairStep = false;
        this.updateSenderFilterUI();
        this.updateUI();
      });

      this.senderChunksGrid.appendChild(box);
    }

    this.updateSenderFilterUI();
  }

  updateSenderFilterUI() {
    const hasFilter = this.selectedChunks.size > 0;
    if (this.btnResetSenderFilter) {
      this.btnResetSenderFilter.classList.toggle('hidden', !hasFilter);
    }
    if (this.senderFilterLabel) {
      if (hasFilter) {
        const list = Array.from(this.selectedChunks).sort((a, b) => a - b).map(i => `#${i + 1}`).join(', ');
        this.senderFilterLabel.textContent = `Looping ONLY (${this.selectedChunks.size}): ${list}`;
        this.senderFilterLabel.style.color = 'var(--accent-color)';
      } else {
        this.senderFilterLabel.textContent = 'Tap chunks below to loop only missing ones';
        this.senderFilterLabel.style.color = 'var(--text-secondary)';
      }
    }

    for (let i = 0; i < this.chunks.length; i++) {
      const box = document.getElementById(`sender-chunk-box-${i}`);
      if (box) {
        box.classList.toggle('selected-filter', this.selectedChunks.has(i));
      }
    }
  }

  highlightActiveSenderChunks(activeIndices, isFountain = false) {
    for (let i = 0; i < this.chunks.length; i++) {
      const box = document.getElementById(`sender-chunk-box-${i}`);
      if (box) {
        const isActive = activeIndices.includes(i);
        box.classList.toggle('active-sending', isActive && !isFountain);
        box.classList.toggle('active-fountain', isActive && isFountain);
      }
    }
  }

  pickFountainIndices(pool) {
    const L = pool.length;
    if (L < 2) return pool.slice();

    const r = this.repairCounter++;
    // Alternate between degree-2 pairs and degree-3 triples (when L >= 3)
    const useTriple = L >= 3 && (r % 3 === 2);
    const stride = (Math.floor(r / L) % (L - 1)) + 1;

    const i1 = pool[r % L];
    const i2 = pool[(r + stride) % L];
    if (!useTriple) {
      return [i1, i2].sort((a, b) => a - b);
    }

    const i3 = pool[(r + stride * 2 + 1) % L];
    const unique = Array.from(new Set([i1, i2, i3]));
    if (unique.length < 2) {
      return [pool[0], pool[1]].sort((a, b) => a - b);
    }
    return unique.sort((a, b) => a - b);
  }

  async handleFileSelected(file) {
    this.originalFile = file;
    this.originalFileBytes = file.size;
    const isOptimizableImage = file.type && file.type.startsWith('image/') && !file.type.includes('svg') && !file.type.includes('gif');
    if (this.imageOptItem) {
      this.imageOptItem.classList.toggle('hidden', !isOptimizableImage);
    }

    await this.processSelectedFile(file);
    this.startStreaming();
  }

  async processSelectedFile(file) {
    const isOptimizableImage = file.type && file.type.startsWith('image/') && !file.type.includes('svg') && !file.type.includes('gif');
    if (isOptimizableImage && this.imageOptMode !== 'original' && file.size > 8192) {
      try {
        const maxDim = this.imageOptMode === 'webp480' ? 480 : 800;
        const quality = this.imageOptMode === 'webp480' ? 0.68 : 0.78;
        const optimized = await this.compressImageToBuffer(file, maxDim, quality);
        if (optimized && optimized.buffer.byteLength < file.size) {
          this.rawContent = optimized.buffer;
          const baseName = file.name.replace(/\.[^.]+$/, '');
          this.filename = `${baseName}.${optimized.ext}`;
          return;
        }
      } catch (e) {
        console.warn('Image optimization skipped, using original file:', e);
      }
    }

    this.filename = file.name;
    this.rawContent = await file.arrayBuffer();
  }

  compressImageToBuffer(file, maxDim = 800, quality = 0.78) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(async (blob) => {
          if (!blob) return reject(new Error('Canvas toBlob failed'));
          const ext = blob.type.includes('webp') ? 'webp' : 'jpg';
          const buffer = await blob.arrayBuffer();
          resolve({ buffer, ext });
        }, 'image/webp', quality);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  getChunksPerStep() {
    const colorMultiplier = this.colorMode === 'rgb' ? 3 : 1;
    return this.gridSize * colorMultiplier;
  }

  startStreaming() {
    this.generateChunks();
    
    // Hide inputs, show active stream card
    this.streamContainer.classList.remove('hidden');
    this.dropzone.classList.add('hidden');
    document.querySelector('.divider').classList.add('hidden');
    document.querySelector('.text-input-card').classList.add('hidden');
    
    this.transferTitle.textContent = this.filename === '_clip_' 
      ? 'Streaming Clipboard Content' 
      : `Streaming: ${this.filename}`;
      
    this.isPlaying = false;
    this.currentIndex = 0;
    this.updateUI();
    
    const totalSteps = Math.ceil(this.chunks.length / this.getChunksPerStep());
    if (totalSteps === 1) {
      this.play(); // Auto-start immediately since there is only one frame set
    } else {
      this.pause(); // Start paused to allow time to align camera for multi-frame sequences
    }
  }

  stopStreaming() {
    this.pause();
    this.streamContainer.classList.add('hidden');
    this.dropzone.classList.remove('hidden');
    document.querySelector('.divider').classList.remove('hidden');
    document.querySelector('.text-input-card').classList.remove('hidden');
    this.rawContent = null;
    this.originalFile = null;
    this.chunks = [];
  }

  generateChunks() {
    if (!this.rawContent) return;
    this.chunks = prepareChunks(this.rawContent, this.filename, this.chunkSize, this.encoding);
    this.selectedChunks.clear();
    this.completedPasses = 0;
    this.repairCounter = 0;
    this.isShowingRepairStep = false;
    this.currentIndex = 0;
    this.updateCompressionBadge();
    this.buildSenderGrid();
    this.updateUI();
  }

  updateCompressionBadge() {
    if (!this.compressionStatsBadge || !this.chunks.stats) return;
    const stats = this.chunks.stats;
    const origBytes = this.originalFileBytes || stats.originalBytes;
    const finalBytes = stats.compressedBytes;
    if (origBytes > finalBytes) {
      const savedPct = Math.round(((origBytes - finalBytes) / origBytes) * 100);
      this.compressionStatsBadge.textContent = `Compressed: ${this.formatBytes(origBytes)} → ${this.formatBytes(finalBytes)} (-${savedPct}%)`;
    } else {
      this.compressionStatsBadge.textContent = `Size: ${this.formatBytes(finalBytes)} (Already optimal)`;
    }
  }

  renderRGBMultiplexedQR(canvas, tripletTexts, lightHex) {
    // Ensure exactly 3 texts (pad by repeating if fewer than 3 chunks remain)
    const texts = [
      tripletTexts[0],
      tripletTexts[1] || tripletTexts[0],
      tripletTexts[2] || tripletTexts[0]
    ];

    // First create QR matrices to find the maximum version among the 3 so all 3 share the exact module grid
    const initialQRs = texts.map(t => QRCode.create(t, { errorCorrectionLevel: this.eccLevel }));
    const maxVersion = Math.max(...initialQRs.map(q => q.version));
    const qrs = initialQRs.map((q, idx) =>
      q.version === maxVersion
        ? q
        : QRCode.create(texts[idx], { version: maxVersion, errorCorrectionLevel: this.eccLevel })
    );

    const moduleCount = qrs[0].modules.size;
    const margin = 3;
    const totalCells = moduleCount + margin * 2;
    const canvasSize = 400;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    const ctx = canvas.getContext('2d');
    const lightVal = lightHex === '#d1d5db' ? 212 : 255;
    const imgData = ctx.createImageData(canvasSize, canvasSize);
    const data = imgData.data;

    const rData = qrs[0].modules.data;
    const gData = qrs[1].modules.data;
    const bData = qrs[2].modules.data;

    for (let y = 0; y < canvasSize; y++) {
      const cellRow = Math.floor((y * totalCells) / canvasSize) - margin;
      const inRowBounds = cellRow >= 0 && cellRow < moduleCount;
      const rowOffset = cellRow * moduleCount;

      for (let x = 0; x < canvasSize; x++) {
        const cellCol = Math.floor((x * totalCells) / canvasSize) - margin;
        const inBounds = inRowBounds && cellCol >= 0 && cellCol < moduleCount;

        let r = lightVal;
        let g = lightVal;
        let b = lightVal;

        if (inBounds) {
          const mIdx = rowOffset + cellCol;
          if (rData[mIdx]) r = 0;
          if (gData[mIdx]) g = 0;
          if (bData[mIdx]) b = 0;
        }

        const pIdx = (y * canvasSize + x) << 2;
        data[pIdx] = r;
        data[pIdx + 1] = g;
        data[pIdx + 2] = b;
        data[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  async renderPayloadsToQR(payloads) {
    this.qrContainer.innerHTML = '';
    this.qrContainer.className = `qr-display-area cols-${this.gridSize}${this.antiGlare ? ' antiglare' : ''}`;
    const lightColor = this.antiGlare ? '#d1d5db' : '#ffffff';

    if (this.colorMode === 'rgb') {
      for (let i = 0; i < payloads.length; i += 3) {
        const triplet = payloads.slice(i, i + 3);
        const canvas = document.createElement('canvas');
        canvas.className = 'qr-canvas-item';
        this.qrContainer.appendChild(canvas);
        try {
          this.renderRGBMultiplexedQR(canvas, triplet, lightColor);
        } catch (err) {
          console.error('Failed to generate RGB QR Code:', err);
        }
      }
      return;
    }

    for (const text of payloads) {
      const canvas = document.createElement('canvas');
      canvas.className = 'qr-canvas-item';
      this.qrContainer.appendChild(canvas);

      try {
        await QRCode.toCanvas(canvas, text, {
          width: 400,
          margin: 3,
          color: {
            dark: '#000000',
            light: lightColor
          },
          errorCorrectionLevel: this.eccLevel
        });
      } catch (err) {
        console.error('Failed to generate QR Code:', err);
      }
    }
  }

  async renderCurrentQR() {
    this.updateUI();
  }

  updateUI() {
    if (this.chunks.length === 0) return;

    const activeIndices = this.getActiveChunkIndices();
    const chunksPerStep = this.getChunksPerStep();
    const totalSteps = Math.max(1, Math.ceil(activeIndices.length / chunksPerStep));
    if (this.currentIndex >= totalSteps) {
      this.currentIndex = 0;
    }

    // Determine whether this step renders a Fountain Repair frame set
    if (this.isShowingRepairStep && activeIndices.length >= 2) {
      const payloads = [];
      const highlighted = [];
      const labels = [];

      for (let g = 0; g < chunksPerStep; g++) {
        const combo = this.pickFountainIndices(activeIndices);
        const repairQR = createFountainChunk(this.chunks, combo);
        if (repairQR) {
          payloads.push(repairQR);
          highlighted.push(...combo);
          labels.push(combo.map(i => `#${i + 1}`).join('⊕'));
        }
      }

      if (payloads.length > 0) {
        const modeTag = this.colorMode === 'rgb' ? 'RGB 3x ' : '';
        this.chunkIndexIndicator.textContent = `${modeTag}Fountain Repair QR (${labels.join(', ')})`;
        this.highlightActiveSenderChunks(Array.from(new Set(highlighted)), true);
        this.renderPayloadsToQR(payloads);
        return;
      }
    }

    const startIdx = this.currentIndex * chunksPerStep;
    const endIdx = Math.min(startIdx + chunksPerStep, activeIndices.length);
    const currentChunkIndices = activeIndices.slice(startIdx, endIdx);
    const payloads = currentChunkIndices.map(idx => this.chunks[idx]);

    const chunkLabels = currentChunkIndices.map(i => `#${i + 1}`).join(', ');
    const modePrefix = this.colorMode === 'rgb' ? 'RGB 3x • ' : '';
    this.chunkIndexIndicator.textContent = `${modePrefix}Step ${this.currentIndex + 1}/${totalSteps} (Chunk ${chunkLabels} of ${this.chunks.length})`;
    const percent = ((this.currentIndex + 1) / totalSteps) * 100;
    this.progressBar.style.width = `${percent}%`;

    this.highlightActiveSenderChunks(currentChunkIndices, false);
    this.renderPayloadsToQR(payloads);
  }

  shouldUseFountainRepair(activeCount) {
    if (activeCount < 2 || this.fountainMode === 'off') return false;
    if (this.fountainMode === 'always') return true;
    // 'smart': turn on Fountain Repair automatically once Pass 1 has completed
    return this.completedPasses >= 1;
  }

  advanceStep(direction = 1) {
    const activeIndices = this.getActiveChunkIndices();
    const chunksPerStep = this.getChunksPerStep();
    const totalSteps = Math.max(1, Math.ceil(activeIndices.length / chunksPerStep));

    if (direction > 0 && this.shouldUseFountainRepair(activeIndices.length)) {
      if (!this.isShowingRepairStep) {
        // Interleave a Fountain Repair step right after this normal step
        this.isShowingRepairStep = true;
        this.updateUI();
        return;
      }
      this.isShowingRepairStep = false;
    } else {
      this.isShowingRepairStep = false;
    }

    const nextIdx = this.currentIndex + direction;
    if (nextIdx >= totalSteps) {
      this.completedPasses++;
      this.currentIndex = 0;
    } else if (nextIdx < 0) {
      this.currentIndex = totalSteps - 1;
    } else {
      this.currentIndex = nextIdx;
    }

    this.updateUI();
  }

  play() {
    this.isPlaying = true;
    this.btnPlayPause.textContent = 'Pause';
    this.btnPlayPause.classList.remove('btn-secondary');
    this.btnPlayPause.classList.add('btn-primary');
    
    if (this.playInterval) clearInterval(this.playInterval);
    this.playInterval = setInterval(() => {
      this.advanceStep(1);
    }, 1000 / this.fps);
  }

  pause() {
    this.isPlaying = false;
    this.btnPlayPause.textContent = 'Start / Resume';
    this.btnPlayPause.classList.remove('btn-primary');
    this.btnPlayPause.classList.add('btn-secondary');
    
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  prevChunk() {
    this.pause();
    this.advanceStep(-1);
  }

  nextChunk() {
    this.pause();
    this.advanceStep(1);
  }
}
