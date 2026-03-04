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
 * Encode an AudioBuffer to a 16-bit PCM WAV file.
 * This is the ONLY WAV writing code in the app — no byte-level header parsing.
 */
function audioBufferToWav(buffer) {
  var numChannels = buffer.numberOfChannels;
  var sampleRate = buffer.sampleRate;
  var format = 1; // PCM
  var bitDepth = 16;
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
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
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
 * Export a sample using the Web Audio API pipeline (identical to preview).
 * Decodes via decodeAudioData, slices the AudioBuffer, re-encodes to WAV.
 * Guaranteed to match what the preview plays.
 */
async function exportTrimmedSample(fileBytes, trimStartSample, outputPath) {
  var ctx = getAudioContext();
  var arrayBuffer = new Uint8Array(fileBytes).buffer.slice(0);
  var audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  var startSample = trimStartSample || 0;
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

  var wavBytes = audioBufferToWav(outputBuffer);

  console.log(
    '  Encoded via Web Audio: ' + audioBuffer.numberOfChannels + 'ch, ' +
    audioBuffer.sampleRate + 'Hz, startSample=' + startSample +
    ', outputSamples=' + length + ', wavSize=' + wavBytes.length
  );

  await window.__TAURI__.core.invoke('write_file_bytes', {
    path: outputPath,
    bytes: Array.from(wavBytes)
  });
}
