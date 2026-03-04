/* wallpaper-gen.js — Generate Kontakt wallpaper PNG (633x500) */
/* Top ~130px is behind Kontakt's instrument header — keep clean. */

/**
 * Generate a dark wallpaper PNG for Kontakt's resource container.
 * Bakes control labels into the wallpaper image (no separate ui_label controls).
 * Returns a Uint8Array of PNG data.
 *
 * @param {string} instrumentName - Instrument name to render
 * @param {number} sampleCount - Number of mapped samples
 * @param {Array} enabledControls - Array of enabled control objects (from getEnabledControls)
 * @returns {Promise<Uint8Array>} PNG bytes
 */
async function generateWallpaper(instrumentName, sampleCount, enabledControls) {
  enabledControls = enabledControls || [];
  var width = 633;
  var height = 500;

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

  // Instrument name — below header area (Y=140)
  ctx.fillStyle = '#ededf0';
  ctx.font = '600 20px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(instrumentName, 20, 140);

  // "SAMPLEARCHITECT" watermark — right side, same row (Y=148)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.font = '600 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.letterSpacing = '0.14em';
  ctx.fillText('SAMPLEARCHITECT', width - 16, 148);
  ctx.letterSpacing = '0';

  // Subtle horizontal separator line at Y=170
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(width, 170);
  ctx.stroke();

  // Sample count — just below separator (Y=178)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = '400 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(sampleCount + ' samples', 20, 178);

  // Bake control labels into the wallpaper (matches ksp-gen.js layout)
  if (enabledControls.length > 0) {
    var startX = 30;
    var knobY = 200;
    var labelSpacing = 75;
    var maxPerRow = 6;
    var knobSize = 54;

    ctx.fillStyle = '#666666';
    ctx.font = '600 10px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    enabledControls.forEach(function(item, index) {
      var row = Math.floor(index / maxPerRow);
      var col = index % maxPerRow;
      var x = startX + (col * labelSpacing) + (knobSize / 2);
      var y = knobY + (row * 110) + 62;
      var label = (KNOB_FULL_LABELS[item.key] || item.key).toUpperCase();
      ctx.fillText(label, x, y);
    });
  }

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
