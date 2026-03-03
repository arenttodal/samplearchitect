/* audio.js — Web Audio API preview player */

var audioCtx = null;
var currentSource = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function stopPreview() {
  if (currentSource) {
    try { currentSource.stop(); } catch(e) {}
    currentSource = null;
  }
}

async function previewSample(filePath) {
  stopPreview();

  try {
    // Use Tauri command to read file bytes
    var bytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: filePath });
    var ctx = getAudioContext();
    var arrayBuffer = new Uint8Array(bytes).buffer;
    var audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    var source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0);
    currentSource = source;

    source.onended = function() {
      currentSource = null;
    };
  } catch (err) {
    console.error('Preview failed:', err);
  }
}
