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

  handleFileSelected(file) {
    this.filename = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.rawContent = e.target.result; // ArrayBuffer
      this.startStreaming();
    };
    reader.readAsArrayBuffer(file);
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
    
    const totalSteps = Math.ceil(this.chunks.length / this.gridSize);
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
    this.buildSenderGrid();
    this.updateUI();
  }

  async renderPayloadsToQR(payloads) {
    this.qrContainer.innerHTML = '';
    this.qrContainer.className = `qr-display-area cols-${this.gridSize}${this.antiGlare ? ' antiglare' : ''}`;
    const lightColor = this.antiGlare ? '#d1d5db' : '#ffffff';

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
          errorCorrectionLevel: 'M'
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
    const totalSteps = Math.max(1, Math.ceil(activeIndices.length / this.gridSize));
    if (this.currentIndex >= totalSteps) {
      this.currentIndex = 0;
    }

    // Determine whether this step renders a Fountain Repair frame set
    if (this.isShowingRepairStep && activeIndices.length >= 2) {
      const payloads = [];
      const highlighted = [];
      const labels = [];

      for (let g = 0; g < this.gridSize; g++) {
        const combo = this.pickFountainIndices(activeIndices);
        const repairQR = createFountainChunk(this.chunks, combo);
        if (repairQR) {
          payloads.push(repairQR);
          highlighted.push(...combo);
          labels.push(combo.map(i => `#${i + 1}`).join('⊕'));
        }
      }

      if (payloads.length > 0) {
        this.chunkIndexIndicator.textContent = `Fountain Repair QR (${labels.join(', ')})`;
        this.highlightActiveSenderChunks(Array.from(new Set(highlighted)), true);
        this.renderPayloadsToQR(payloads);
        return;
      }
    }

    const startIdx = this.currentIndex * this.gridSize;
    const endIdx = Math.min(startIdx + this.gridSize, activeIndices.length);
    const currentChunkIndices = activeIndices.slice(startIdx, endIdx);
    const payloads = currentChunkIndices.map(idx => this.chunks[idx]);

    const chunkLabels = currentChunkIndices.map(i => `#${i + 1}`).join(', ');
    this.chunkIndexIndicator.textContent = `Step ${this.currentIndex + 1}/${totalSteps} (Chunk ${chunkLabels} of ${this.chunks.length})`;
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
    const totalSteps = Math.max(1, Math.ceil(activeIndices.length / this.gridSize));

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
