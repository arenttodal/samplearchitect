/* trimmer.js — Trim leading silence from WAV samples */
/* Uses Web Audio API for decoding — no manual WAV byte parsing */

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
      // Leave 100ms pre-roll to preserve full attack transient
      // Better to keep a tiny bit of silence than clip the attack
      trimStart = Math.max(0, i - Math.floor(sampleRate * 0.1));
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
 * Read the format fields of a WAV file's fmt chunk. Returns null if absent.
 */
function parseWavFormat(u8) {
  if (u8.length < 12) return null;
  var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'RIFF') return null;
  var off = 12;
  while (off + 8 <= u8.length) {
    var id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    var size = view.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 24 <= u8.length) {
      return {
        formatTag: view.getUint16(off + 8, true),
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true)
      };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Decode at the file's own sample rate. A realtime AudioContext would
 * resample to the output device rate (e.g. 44.1 kHz -> 48 kHz).
 */
async function decodeAtNativeRate(arrayBuffer) {
  var fmt = parseWavFormat(new Uint8Array(arrayBuffer));
  var rate = fmt && fmt.sampleRate >= 3000 && fmt.sampleRate <= 768000
    ? fmt.sampleRate
    : getAudioContext().sampleRate;
  var ctx = new OfflineAudioContext(1, 1, rate);
  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * Encode an AudioBuffer to a 16- or 24-bit PCM WAV file.
 * This is the ONLY WAV writing code in the app — no byte-level header parsing.
 */
function audioBufferToWav(buffer, bitDepth) {
  bitDepth = bitDepth === 24 ? 24 : 16;
  var numChannels = buffer.numberOfChannels;
  var sampleRate = buffer.sampleRate;
  var format = 1; // PCM
  var bytesPerSample = bitDepth / 8;
  var blockAlign = numChannels * bytesPerSample;

  var channels = [];
  for (var i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }
  var numSamples = channels[0].length;
  var dataSize = numSamples * blockAlign;
  var headerSize = 44;
  var arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  var view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  var offset = 44;
  for (var s = 0; s < numSamples; s++) {
    for (var ch = 0; ch < numChannels; ch++) {
      var sample = Math.max(-1, Math.min(1, channels[ch][s]));
      if (bitDepth === 24) {
        var v = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF);
        view.setUint8(offset, v & 0xFF);
        view.setUint8(offset + 1, (v >> 8) & 0xFF);
        view.setUint8(offset + 2, (v >> 16) & 0xFF);
        offset += 3;
      } else {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
  }
  return new Uint8Array(arrayBuffer);
}

function writeString(view, offset, string) {
  for (var i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Export a sample with its leading silence removed.
 * Decodes at the native rate (same as trim analysis, so trimStartSample
 * lines up), slices, and re-encodes at 24-bit if the source was 24-bit or
 * float, otherwise 16-bit.
 */
async function exportTrimmedSample(fileBytes, trimStartSample, outputPath) {
  var fmt = parseWavFormat(new Uint8Array(fileBytes));
  var audioBuffer = await decodeAtNativeRate(fileBytes.slice(0));

  var startSample = Math.min(trimStartSample || 0, audioBuffer.length - 1);
  var length = audioBuffer.length - startSample;

  var outputBuffer = new AudioBuffer({
    numberOfChannels: audioBuffer.numberOfChannels,
    length: length,
    sampleRate: audioBuffer.sampleRate
  });
  for (var ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    var source = audioBuffer.getChannelData(ch);
    var dest = outputBuffer.getChannelData(ch);
    dest.set(source.subarray(startSample));
  }

  var bitDepth = fmt && fmt.bitsPerSample >= 24 ? 24 : 16;
  var wavBytes = audioBufferToWav(outputBuffer, bitDepth);

  await writeFileBytes(outputPath, wavBytes);
}
