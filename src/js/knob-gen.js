/* knob-gen.js — Generate 128-frame knob strip PNG for Kontakt */

/**
 * Generate a vertical PNG strip of 128 knob frames (54x54 each).
 * Total image: 54px wide × 6912px tall (54 × 128).
 *
 * Each frame shows an arc-style knob with:
 * - Dark circle background
 * - Gray track arc (270°)
 * - Green value arc proportional to frame index
 * - White dot indicator at current position
 *
 * @returns {Promise<Uint8Array>} PNG bytes
 */
async function generateKnobStrip() {
  var frameSize = 54;
  var totalFrames = 128;
  var width = frameSize;
  var height = frameSize * totalFrames; // 6912

  var canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }

  var ctx = canvas.getContext('2d');

  // Arc geometry
  var cx = frameSize / 2;       // 27
  var radius = 20;
  var trackWidth = 3;
  var startAngle = (135 * Math.PI) / 180;   // 135° (bottom-left)
  var endAngle = (405 * Math.PI) / 180;     // 405° = 45° (bottom-right)
  var arcSpan = endAngle - startAngle;       // 270°
  var dotRadius = 3;

  for (var frame = 0; frame < totalFrames; frame++) {
    var cy = frame * frameSize + frameSize / 2;
    var ratio = frame / (totalFrames - 1); // 0.0 to 1.0

    // Dark circle background
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#141418';
    ctx.fill();

    // Gray track arc (full 270°)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = trackWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Green value arc (proportional to frame)
    if (ratio > 0.005) {
      var valueEnd = startAngle + arcSpan * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, valueEnd);
      ctx.strokeStyle = '#3dd68c';
      ctx.lineWidth = trackWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // White dot indicator at current position
    var dotAngle = startAngle + arcSpan * ratio;
    var dotX = cx + radius * Math.cos(dotAngle);
    var dotY = cy + radius * Math.sin(dotAngle);
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
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
