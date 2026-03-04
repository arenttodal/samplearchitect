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

  // Always use DOM canvas — OffscreenCanvas may silently clamp dimensions
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  console.log('[SampleArchitect] Knob canvas: ' + canvas.width + 'x' + canvas.height +
    ' (expected ' + width + 'x' + height + ')');

  // Verify dimensions were actually set
  if (canvas.width !== width || canvas.height !== height) {
    console.error('[SampleArchitect] Canvas dimension mismatch! Got ' +
      canvas.width + 'x' + canvas.height + ', expected ' + width + 'x' + height);
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

  // Export to PNG via DOM canvas toBlob
  var blob = await new Promise(function(resolve) {
    canvas.toBlob(resolve, 'image/png');
  });

  var arrayBuffer = await blob.arrayBuffer();
  var pngBytes = new Uint8Array(arrayBuffer);

  // Verify PNG dimensions by reading IHDR chunk (bytes 16-23)
  if (pngBytes.length > 24) {
    var pngWidth = (pngBytes[16] << 24) | (pngBytes[17] << 16) | (pngBytes[18] << 8) | pngBytes[19];
    var pngHeight = (pngBytes[20] << 24) | (pngBytes[21] << 16) | (pngBytes[22] << 8) | pngBytes[23];
    console.log('[SampleArchitect] Knob PNG IHDR: ' + pngWidth + 'x' + pngHeight +
      ' (' + pngBytes.length + ' bytes)');
    if (pngWidth !== width || pngHeight !== height) {
      console.error('[SampleArchitect] PNG dimension mismatch! IHDR says ' +
        pngWidth + 'x' + pngHeight + ', expected ' + width + 'x' + height);
    }
  }

  return pngBytes;
}
