/* wallpaper-gen.js — Generate Kontakt wallpaper PNG (633x330) */

/**
 * Generate a dark wallpaper PNG for Kontakt's resource container.
 * Returns a Uint8Array of PNG data.
 *
 * @param {string} instrumentName - Instrument name to render
 * @param {number} sampleCount - Number of mapped samples
 * @returns {Promise<Uint8Array>} PNG bytes
 */
async function generateWallpaper(instrumentName, sampleCount) {
  var width = 633;
  var height = 330;

  var canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }

  var ctx = canvas.getContext('2d');

  // Background gradient: dark top to slightly lighter bottom
  var grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0a0a0b');
  grad.addColorStop(1, '#111116');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle horizontal separator line at y=32
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 32);
  ctx.lineTo(width, 32);
  ctx.stroke();

  // Instrument name — top left
  ctx.fillStyle = '#ededf0';
  ctx.font = '600 20px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(instrumentName, 20, 16);

  // "SAMPLEARCHITECT" watermark — top right
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.font = '600 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.letterSpacing = '0.14em';
  ctx.fillText('SAMPLEARCHITECT', width - 16, 16);
  ctx.letterSpacing = '0';

  // Sample count — bottom left
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = '400 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(sampleCount + ' samples', 20, height - 12);

  // Export to PNG
  var blob;
  if (typeof canvas.convertToBlob === 'function') {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise(function(resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
  }

  var arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
