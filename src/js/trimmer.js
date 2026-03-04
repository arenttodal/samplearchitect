/* trimmer.js — Trim leading silence from WAV samples */

/**
 * Find trim points in a decoded AudioBuffer.
 * Only trims leading silence — the tail is never touched.
 */
function findTrimPoints(audioBuffer, thresholdDb) {
  if (thresholdDb === undefined) thresholdDb = -40;

  var data = audioBuffer.getChannelData(0);
  var startThreshold = Math.pow(10, thresholdDb / 20);    // -40dB for attack detection
  var sampleRate = audioBuffer.sampleRate;

  // Find first sample above start threshold
  var trimStart = 0;
  for (var i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > startThreshold) {
      // Leave 50ms pre-roll to preserve full attack transient
      trimStart = Math.max(0, i - Math.floor(sampleRate * 0.05));
      break;
    }
  }

  // End is always the full sample length — never trim tails
  var trimEnd = data.length;

  var originalDuration = data.length / sampleRate;
  var silenceRemoved = trimStart / sampleRate;

  return {
    startSample: trimStart,
    endSample: trimEnd,
    startTime: trimStart / sampleRate,
    endTime: trimEnd / sampleRate,
    originalDuration: originalDuration,
    trimmedDuration: originalDuration - silenceRemoved,
    silenceRemoved: silenceRemoved,
    significant: silenceRemoved > 0.5
  };
}

/**
 * Parse a WAV file header from raw bytes.
 * Returns format info needed for trimming.
 */
function parseWavHeader(bytes) {
  var view = new DataView(bytes.buffer || bytes);

  // Verify RIFF header
  var riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') return null;

  var wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') return null;

  var numChannels = 0;
  var sampleRate = 0;
  var bitsPerSample = 0;
  var dataOffset = 0;
  var dataSize = 0;
  var fmtFound = false;

  // Walk through chunks
  var offset = 12;
  while (offset < bytes.length - 8) {
    var chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    var chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
      fmtFound = true;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // Chunks are word-aligned
    if (chunkSize % 2 !== 0) offset++;
  }

  if (!fmtFound || dataOffset === 0) return null;

  var bytesPerSample = bitsPerSample / 8;
  var blockAlign = numChannels * bytesPerSample;

  return {
    numChannels: numChannels,
    sampleRate: sampleRate,
    bitsPerSample: bitsPerSample,
    bytesPerSample: bytesPerSample,
    blockAlign: blockAlign,
    dataOffset: dataOffset,
    dataSize: dataSize,
    headerBytes: bytes.slice(0, dataOffset)
  };
}

/**
 * Trim a WAV file's raw bytes based on sample indices.
 * Returns new Uint8Array with a valid WAV file.
 */
function trimWavBytes(rawBytes, trimStartSample, trimEndSample) {
  var bytes = new Uint8Array(rawBytes);
  var header = parseWavHeader(bytes);
  if (!header) return bytes; // Can't parse, return original

  var blockAlign = header.blockAlign;
  var startByte = header.dataOffset + (trimStartSample * blockAlign);
  var endByte = header.dataOffset + (trimEndSample * blockAlign);

  // Clamp to actual data bounds
  startByte = Math.max(header.dataOffset, startByte);
  endByte = Math.min(header.dataOffset + header.dataSize, endByte);

  var newDataSize = endByte - startByte;
  var trimmedData = bytes.slice(startByte, endByte);

  // Rebuild WAV file: reuse everything before data chunk, update sizes
  // Find the data chunk header position (dataOffset - 8)
  var dataChunkHeaderPos = header.dataOffset - 8;

  // Copy everything before data chunk + data chunk header
  var preDataBytes = bytes.slice(0, header.dataOffset);
  var newFileSize = preDataBytes.length + newDataSize;

  var output = new Uint8Array(newFileSize);
  output.set(preDataBytes, 0);
  output.set(trimmedData, preDataBytes.length);

  // Update RIFF chunk size (offset 4): fileSize - 8
  var outView = new DataView(output.buffer);
  outView.setUint32(4, newFileSize - 8, true);

  // Update data chunk size (dataChunkHeaderPos + 4)
  outView.setUint32(dataChunkHeaderPos + 4, newDataSize, true);

  return output;
}
