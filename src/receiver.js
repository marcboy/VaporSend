import jsQR from 'jsqr';
import { parseChunk, reconstructData } from './compress';

export class Receiver {
  constructor() {
    this.stream = null;
    this.isDecoding = false;
    this.animationFrameId = null;

    // Session State
    this.currentSessionId = null;
    this.totalChunks = 0;
    this.filename = '';
    this.chunksReceived = {}; // Key: Index, Value: Base64 payload
    this.isFinished = false;

    // DOM Elements
    this.video = document.getElementById('camera-video');
    this.canvas = document.getElementById('camera-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cameraSelect = document.getElementById('camera-select');
    this.btnToggleCamera = document.getElementById('btn-toggle-camera');
    
    this.progressPanel = document.getElementById('receive-progress-panel');
    this.fileInfoText = document.getElementById('recv-file-info');
    this.percentageText = document.getElementById('recv-percentage');
    this.progressBar = document.getElementById('recv-progress-bar');
    this.chunksGrid = document.getElementById('chunks-grid');
    
    this.resultCard = document.getElementById('result-card');
    this.resultTitle = document.getElementById('result-title');
    this.resultDetails = document.getElementById('result-details');
    this.btnDownloadResult = document.getElementById('btn-download-result');
    this.btnCopyResult = document.getElementById('btn-copy-result');
    this.btnResetRecv = document.getElementById('btn-reset-recv');
    
    this.downloadBlobUrl = null;
    this.decryptedText = null;

    this.initEventListeners();
    this.detectCameras();
  }

  initEventListeners() {
    this.btnToggleCamera.addEventListener('click', () => this.toggleCamera());
    this.cameraSelect.addEventListener('change', () => {
      if (this.stream) {
        this.stopCamera();
        this.startCamera();
      }
    });
    
    this.btnResetRecv.addEventListener('click', () => this.resetReceiver());
    this.btnDownloadResult.addEventListener('click', () => this.downloadFile());
    this.btnCopyResult.addEventListener('click', () => this.copyToClipboard());
  }

  async detectCameras() {
    try {
      // Prompt permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
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

  async toggleCamera() {
    if (this.stream) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  async startCamera() {
    const deviceId = this.cameraSelect.value;
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }
    };
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', true); // critical for iOS
      this.video.play();
      
      this.btnToggleCamera.textContent = 'Stop Camera';
      this.btnToggleCamera.classList.remove('btn-secondary');
      this.btnToggleCamera.classList.add('btn-outline');
      
      this.isDecoding = true;
      this.video.addEventListener('loadedmetadata', () => {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.tick();
      });
    } catch (err) {
      console.error('Camera open failed:', err);
      alert('Could not start camera. Check permissions and try again.');
    }
  }

  stopCamera() {
    this.isDecoding = false;
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

  tick() {
    if (!this.isDecoding) return;
    
    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      // Draw video frame to hidden canvas
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      
      // Attempt decoding
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      
      if (code && code.data) {
        this.handleDecodedQR(code.data);
      }
    }
    
    this.animationFrameId = requestAnimationFrame(() => this.tick());
  }

  handleDecodedQR(data) {
    const chunk = parseChunk(data);
    if (!chunk) return; // Not a valid chunk for our app
    
    // Check if this is a new transfer session
    if (this.currentSessionId !== chunk.sessionId) {
      this.startNewSession(chunk);
    }
    
    // Write chunk if not already received
    if (!this.chunksReceived[chunk.index]) {
      this.chunksReceived[chunk.index] = chunk.payload;
      this.updateProgressUI(chunk.index);
      
      // Check if we are finished
      if (Object.keys(this.chunksReceived).length === this.totalChunks) {
        this.completeTransfer();
      }
    }
  }

  startNewSession(chunk) {
    this.currentSessionId = chunk.sessionId;
    this.totalChunks = chunk.total;
    this.filename = chunk.filename;
    this.chunksReceived = {};
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
      this.chunksGrid.appendChild(box);
    }
    
    this.updateProgressUI();
  }

  updateProgressUI(newlyReceivedIndex = null) {
    if (newlyReceivedIndex !== null) {
      const box = document.getElementById(`chunk-box-${newlyReceivedIndex}`);
      if (box) {
        box.classList.add('received');
      }
    }
    
    const count = Object.keys(this.chunksReceived).length;
    const percentage = Math.round((count / this.totalChunks) * 100);
    this.percentageText.textContent = `${percentage}% (${count}/${this.totalChunks})`;
    this.progressBar.style.width = `${percentage}%`;
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
      const decompressedData = reconstructData(orderedChunks);
      
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
    this.totalChunks = 0;
    
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
