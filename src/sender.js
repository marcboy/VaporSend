import QRCode from 'qrcode';
import { prepareChunks } from './compress';

export class Sender {
  constructor() {
    this.chunks = [];
    this.currentSessionId = null;
    this.currentIndex = 0;
    this.isPlaying = false;
    this.playInterval = null;
    
    // UI Settings
    this.fps = 10;
    this.chunkSize = 400; // Character capacity per QR code
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
    this.qrCanvas = document.getElementById('sender-qr-canvas');
    this.transferTitle = document.getElementById('transfer-title');
    this.chunkIndexIndicator = document.getElementById('chunk-index-indicator');
    this.fpsIndicator = document.getElementById('fps-indicator');
    this.progressBar = document.getElementById('send-progress-bar');
    
    this.btnPrev = document.getElementById('btn-prev-chunk');
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.btnNext = document.getElementById('btn-next-chunk');
    this.speedSlider = document.getElementById('speed-slider');
    this.chunkSizeSlider = document.getElementById('chunk-size-slider');

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
        this.generateChunks();
        if (wasPlaying) this.play();
      }
    });
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
    
    if (this.chunks.length === 1) {
      this.play(); // Auto-start immediately since there is only one QR frame
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
    this.chunks = prepareChunks(this.rawContent, this.filename, this.chunkSize);
    this.currentIndex = Math.min(this.currentIndex, this.chunks.length - 1);
    this.updateUI();
  }

  async renderCurrentQR() {
    if (this.chunks.length === 0) return;
    const text = this.chunks[this.currentIndex];
    
    try {
      await QRCode.toCanvas(this.qrCanvas, text, {
        width: 320,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M' // Medium is ideal: high density but reliable scanning
      });
    } catch (err) {
      console.error('Failed to generate QR Code:', err);
    }
  }

  updateUI() {
    if (this.chunks.length === 0) return;
    
    this.chunkIndexIndicator.textContent = `Chunk ${this.currentIndex + 1} of ${this.chunks.length}`;
    const percent = ((this.currentIndex + 1) / this.chunks.length) * 100;
    this.progressBar.style.width = `${percent}%`;
    
    this.renderCurrentQR();
  }

  play() {
    this.isPlaying = true;
    this.btnPlayPause.textContent = 'Pause';
    this.btnPlayPause.classList.remove('btn-secondary');
    this.btnPlayPause.classList.add('btn-primary');
    
    if (this.playInterval) clearInterval(this.playInterval);
    this.playInterval = setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.chunks.length;
      this.updateUI();
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
    this.currentIndex = (this.currentIndex - 1 + this.chunks.length) % this.chunks.length;
    this.updateUI();
  }

  nextChunk() {
    this.pause();
    this.currentIndex = (this.currentIndex + 1) % this.chunks.length;
    this.updateUI();
  }
}
