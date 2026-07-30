import pako from 'pako';

const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/**
 * Encodes a Uint8Array into a Base45 string (RFC 9285).
 */
export function uint8ArrayToBase45(uint8Array) {
  let result = "";
  const len = uint8Array.length;
  for (let i = 0; i < len; i += 2) {
    if (i + 1 < len) {
      const val = (uint8Array[i] << 8) + uint8Array[i + 1];
      const c1 = val % 45;
      const c2 = Math.floor(val / 45) % 45;
      const c3 = Math.floor(val / (45 * 45)) % 45;
      result += BASE45_CHARSET[c1] + BASE45_CHARSET[c2] + BASE45_CHARSET[c3];
    } else {
      const val = uint8Array[i];
      const c1 = val % 45;
      const c2 = Math.floor(val / 45) % 45;
      result += BASE45_CHARSET[c1] + BASE45_CHARSET[c2];
    }
  }
  return result;
}

/**
 * Decodes a Base45 string into a Uint8Array (RFC 9285).
 */
export function base45ToUint8Array(base45String) {
  const charToVal = {};
  for (let i = 0; i < 45; i++) {
    charToVal[BASE45_CHARSET[i]] = i;
  }
  
  const result = [];
  const len = base45String.length;
  
  for (let i = 0; i < len; i += 3) {
    if (i + 2 < len) {
      const c1 = charToVal[base45String[i]];
      const c2 = charToVal[base45String[i + 1]];
      const c3 = charToVal[base45String[i + 2]];
      
      if (c1 === undefined || c2 === undefined || c3 === undefined) {
        throw new Error("Invalid character in Base45 string");
      }
      
      const val = c1 + c2 * 45 + c3 * 45 * 45;
      result.push((val >> 8) & 0xff);
      result.push(val & 0xff);
    } else {
      const c1 = charToVal[base45String[i]];
      const c2 = charToVal[base45String[i + 1]];
      
      if (c1 === undefined || c2 === undefined) {
        throw new Error("Invalid character in Base45 string");
      }
      
      const val = c1 + c2 * 45;
      result.push(val & 0xff);
    }
  }
  
  return new Uint8Array(result);
}

/**
 * Encodes a Uint8Array into a Base64 string.
 */
export function uint8ArrayToBase64(uint8Array) {
  let binary = '';
  const len = uint8Array.byteLength;
  const chunkSize = 8192;
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
 * @param {number} maxChunkSize - Max character length of the payload per QR code.
 * @param {string} encoding - Encoding scheme: 'base64' or 'base45'.
 * @returns {Array<string>} Array of ready-to-render QR code text payloads.
 */
export function prepareChunks(data, filename, maxChunkSize = 400, encoding = 'base45') {
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
  const encodedContent = encoding === 'base45' 
    ? uint8ArrayToBase45(compressed) 
    : uint8ArrayToBase64(compressed);
  
  const totalLength = encodedContent.length;
  const numChunks = Math.ceil(totalLength / maxChunkSize);
  
  const sessionId = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * maxChunkSize;
    const end = Math.min(start + maxChunkSize, totalLength);
    const slice = encodedContent.slice(start, end);
    
    const safeFilename = encodeURIComponent(filename).replace(/\|/g, '%7C');
    const encCode = encoding === 'base45' ? '45' : '64';
    const chunkText = `${sessionId}|${numChunks}|${i}|${safeFilename}|${encCode}|${slice}`;
    chunks.push(chunkText);
  }
  
  return chunks;
}

/**
 * Parses a scanned QR code chunk.
 */
export function parseChunk(qrText) {
  const parts = qrText.split('|');
  if (parts.length < 6) return null;
  
  const sessionId = parts[0];
  const total = parseInt(parts[1], 10);
  const index = parseInt(parts[2], 10);
  const filename = decodeURIComponent(parts[3]);
  const encodingCode = parts[4];
  const payload = parts.slice(5).join('|');
  
  if (isNaN(total) || isNaN(index) || !sessionId) {
    return null;
  }
  
  return {
    sessionId,
    total,
    index,
    filename,
    encoding: encodingCode === '45' ? 'base45' : 'base64',
    payload
  };
}

/**
 * Reconstructs the compressed data and decompresses it back.
 */
export function reconstructData(orderedPayloads, encoding) {
  const fullPayload = orderedPayloads.join('');
  const compressedData = encoding === 'base45'
    ? base45ToUint8Array(fullPayload)
    : base64ToUint8Array(fullPayload);
  return pako.ungzip(compressedData);
}
