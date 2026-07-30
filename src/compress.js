import pako from 'pako';

/**
 * Encodes a Uint8Array into a Base64 string.
 * Uses a chunked method to avoid call stack size exceeded errors for large files.
 */
export function uint8ArrayToBase64(uint8Array) {
  let binary = '';
  const len = uint8Array.byteLength;
  const chunkSize = 8192; // Process in chunks to prevent stack overflow
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into a Uint8Array.
 */
export function base64ToUint8Array(base64String) {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses data and splits it into chunks.
 * @param {Uint8Array|string} data - The raw binary data or text string.
 * @param {string} filename - Name of the file, or '_clip_' for clipboard text.
 * @param {number} maxChunkSize - Max character length of the base64 payload per QR code.
 * @returns {Array<string>} Array of ready-to-render QR code text payloads.
 */
export function prepareChunks(data, filename, maxChunkSize = 400) {
  // Convert string to Uint8Array if needed
  let binaryData;
  if (typeof data === 'string') {
    binaryData = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    binaryData = new Uint8Array(data);
  } else {
    binaryData = data;
  }

  // Compress using GZIP
  const compressed = pako.gzip(binaryData);
  const base64Content = uint8ArrayToBase64(compressed);
  
  // Calculate size
  const totalLength = base64Content.length;
  const numChunks = Math.ceil(totalLength / maxChunkSize);
  
  // Generate a random 4-character ID for this specific transfer session
  const sessionId = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * maxChunkSize;
    const end = Math.min(start + maxChunkSize, totalLength);
    const slice = base64Content.slice(start, end);
    
    // Chunk layout: ID|TotalChunks|ChunkIndex|Filename|Payload
    // We encode the filename safely (remove pipes)
    const safeFilename = encodeURIComponent(filename).replace(/\|/g, '%7C');
    const chunkText = `${sessionId}|${numChunks}|${i}|${safeFilename}|${slice}`;
    chunks.push(chunkText);
  }
  
  return chunks;
}

/**
 * Parses a scanned QR code chunk.
 * @param {string} qrText - The decoded text from the QR code.
 * @returns {object|null} Parsed chunk details, or null if invalid.
 */
export function parseChunk(qrText) {
  const parts = qrText.split('|');
  if (parts.length < 5) return null;
  
  const sessionId = parts[0];
  const total = parseInt(parts[1], 10);
  const index = parseInt(parts[2], 10);
  const filename = decodeURIComponent(parts[3]);
  const payload = parts.slice(4).join('|'); // Re-join if payload has pipes
  
  if (isNaN(total) || isNaN(index) || !sessionId) {
    return null;
  }
  
  return {
    sessionId,
    total,
    index,
    filename,
    payload
  };
}

/**
 * Reconstructs the compressed data and decompresses it back to the original file/text.
 * @param {Array<string>} base64Chunks - Array of base64 payload strings ordered by index.
 * @returns {Uint8Array} Decompressed raw data.
 */
export function reconstructData(base64Chunks) {
  const fullBase64 = base64Chunks.join('');
  const compressedData = base64ToUint8Array(fullBase64);
  return pako.ungzip(compressedData);
}
