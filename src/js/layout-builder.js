/* layout-builder.js — Interactive canvas-based knob layout builder for Phase 3 */
/* Canvas is 633×500px — 1:1 with Kontakt performance view pixel coordinates. */
/* Top 130px is Kontakt toolbar mockup (non-interactive). */
/* Knobs can be dragged within the editable area (y >= 130). */

var KNOB_GRAY_DATA_URL = 'data:image/png;base64,' + KNOB_GRAY_BASE64;

var LAYOUT_CANVAS_W = 633;
var LAYOUT_CANVAS_H = 500;
var LAYOUT_TOOLBAR_H = 130;
var LAYOUT_KNOB_SIZE = 54;
var LAYOUT_GRID_SNAP = 10;
var LAYOUT_LABEL_OFFSET_X = -13;
var LAYOUT_LABEL_OFFSET_Y = 58;
var LAYOUT_LABEL_W = 80;
var LAYOUT_LABEL_H = 14;

/* Default 4×2 auto-layout constants */
var LAYOUT_AUTO_START_X = 30;
var LAYOUT_AUTO_START_Y = 200;
var LAYOUT_AUTO_SPACING = 100;
var LAYOUT_AUTO_ROW_SPACING = 110;
var LAYOUT_AUTO_MAX_PER_ROW = 4;

function LayoutBuilder(canvas, opts) {
  opts = opts || {};
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.readonly = !!opts.readonly;
  this.showGrid = !this.readonly;
  this.showToolbar = !this.readonly;

  this.canvas.width = LAYOUT_CANVAS_W;
  this.canvas.height = LAYOUT_CANVAS_H;

  this.knobs = [];       // { key, label, defaultValue, x, y }
  this.fxChain = [];     // [{ label }]
  this.instrumentName = 'Instrument';
  this.sampleCount = 0;

  this.dragging = null;  // index of knob being dragged
  this.dragOffsetX = 0;
  this.dragOffsetY = 0;

  this.knobImage = null;
  this.knobImageLoaded = false;

  this._loadKnobImage();

  if (!this.readonly) {
    this._bindEvents();
  }
}

LayoutBuilder.prototype._loadKnobImage = function() {
  var self = this;
  var img = new Image();
  img.onload = function() {
    self.knobImage = img;
    self.knobImageLoaded = true;
    self.render();
  };
  img.src = KNOB_GRAY_DATA_URL;
};

LayoutBuilder.prototype._bindEvents = function() {
  var self = this;

  this.canvas.addEventListener('mousedown', function(e) {
    var pos = self._canvasPos(e);
    var idx = self._hitTest(pos.x, pos.y);
    if (idx >= 0) {
      self.dragging = idx;
      self.dragOffsetX = pos.x - self.knobs[idx].x;
      self.dragOffsetY = pos.y - self.knobs[idx].y;
      self.canvas.style.cursor = 'grabbing';
    }
  });

  this.canvas.addEventListener('mousemove', function(e) {
    var pos = self._canvasPos(e);
    if (self.dragging != null) {
      var knob = self.knobs[self.dragging];
      var nx = pos.x - self.dragOffsetX;
      var ny = pos.y - self.dragOffsetY;

      // Snap to grid
      nx = Math.round(nx / LAYOUT_GRID_SNAP) * LAYOUT_GRID_SNAP;
      ny = Math.round(ny / LAYOUT_GRID_SNAP) * LAYOUT_GRID_SNAP;

      // Enforce bounds (stay within canvas, below toolbar)
      nx = Math.max(0, Math.min(nx, LAYOUT_CANVAS_W - LAYOUT_KNOB_SIZE));
      ny = Math.max(LAYOUT_TOOLBAR_H, Math.min(ny, LAYOUT_CANVAS_H - LAYOUT_KNOB_SIZE - 20));

      knob.x = nx;
      knob.y = ny;
      self.render();
    } else {
      var hit = self._hitTest(pos.x, pos.y);
      self.canvas.style.cursor = hit >= 0 ? 'grab' : 'default';
    }
  });

  this.canvas.addEventListener('mouseup', function() {
    if (self.dragging != null) {
      self.dragging = null;
      self.canvas.style.cursor = 'default';
      self.render();
    }
  });

  this.canvas.addEventListener('mouseleave', function() {
    if (self.dragging != null) {
      self.dragging = null;
      self.canvas.style.cursor = 'default';
      self.render();
    }
  });
};

LayoutBuilder.prototype._canvasPos = function(e) {
  var rect = this.canvas.getBoundingClientRect();
  var scaleX = LAYOUT_CANVAS_W / rect.width;
  var scaleY = LAYOUT_CANVAS_H / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
};

LayoutBuilder.prototype._hitTest = function(x, y) {
  for (var i = this.knobs.length - 1; i >= 0; i--) {
    var k = this.knobs[i];
    if (x >= k.x && x <= k.x + LAYOUT_KNOB_SIZE &&
        y >= k.y && y <= k.y + LAYOUT_KNOB_SIZE) {
      return i;
    }
  }
  return -1;
};

/* Update controls from template.js helpers */
LayoutBuilder.prototype.updateControls = function() {
  var enabled = getEnabledControls();
  var oldPositions = {};

  // Save existing positions
  this.knobs.forEach(function(k) {
    oldPositions[k.key] = { x: k.x, y: k.y };
  });

  this.knobs = [];
  var self = this;

  enabled.forEach(function(item, index) {
    var key = item.key;
    var pos;

    if (oldPositions[key]) {
      // Preserve user-set position
      pos = oldPositions[key];
    } else {
      // Auto-layout for new knobs
      pos = self._autoPosition(index, enabled.length);
    }

    self.knobs.push({
      key: key,
      label: KNOB_FULL_LABELS[key] || item.config.label.toUpperCase(),
      defaultValue: item.config.default,
      x: pos.x,
      y: pos.y
    });
  });

  this.render();
};

/* Update effects for FX chain display */
LayoutBuilder.prototype.updateEffects = function() {
  var enabled = getEnabledEffects();
  this.fxChain = enabled.map(function(item) {
    return { label: item.config.label };
  });
  this.render();
};

/* Auto-layout: 4×2 grid */
LayoutBuilder.prototype._autoPosition = function(index, total) {
  var row = Math.floor(index / LAYOUT_AUTO_MAX_PER_ROW);
  var col = index % LAYOUT_AUTO_MAX_PER_ROW;
  return {
    x: LAYOUT_AUTO_START_X + col * LAYOUT_AUTO_SPACING,
    y: LAYOUT_AUTO_START_Y + row * LAYOUT_AUTO_ROW_SPACING
  };
};

/* Reset all knobs to auto-layout */
LayoutBuilder.prototype.autoLayout = function() {
  var self = this;
  this.knobs.forEach(function(k, i) {
    var pos = self._autoPosition(i, self.knobs.length);
    k.x = pos.x;
    k.y = pos.y;
  });
  this.render();
};

/* ── Rendering ── */

LayoutBuilder.prototype.render = function() {
  var ctx = this.ctx;
  var w = LAYOUT_CANVAS_W;
  var h = LAYOUT_CANVAS_H;

  // Background
  var grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a0a0b');
  grad.addColorStop(1, '#111116');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Grid (edit mode only)
  if (this.showGrid) {
    this._drawGrid(ctx);
  }

  // Toolbar mockup (edit mode only)
  if (this.showToolbar) {
    this._drawToolbar(ctx);
  }

  // Instrument name and stats (below toolbar)
  this._drawHeader(ctx);

  // Knobs
  this._drawKnobs(ctx);

  // FX chain at bottom
  this._drawFxChain(ctx);
};

LayoutBuilder.prototype._drawGrid = function(ctx) {
  ctx.strokeStyle = 'rgba(255,255,255,0.015)';
  ctx.lineWidth = 1;

  for (var x = 0; x < LAYOUT_CANVAS_W; x += LAYOUT_GRID_SNAP) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, LAYOUT_TOOLBAR_H);
    ctx.lineTo(x + 0.5, LAYOUT_CANVAS_H);
    ctx.stroke();
  }
  for (var y = LAYOUT_TOOLBAR_H; y < LAYOUT_CANVAS_H; y += LAYOUT_GRID_SNAP) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(LAYOUT_CANVAS_W, y + 0.5);
    ctx.stroke();
  }

  // Toolbar boundary line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, LAYOUT_TOOLBAR_H + 0.5);
  ctx.lineTo(LAYOUT_CANVAS_W, LAYOUT_TOOLBAR_H + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
};

LayoutBuilder.prototype._drawToolbar = function(ctx) {
  // Semi-transparent overlay to indicate non-editable area
  ctx.fillStyle = 'rgba(255,255,255,0.012)';
  ctx.fillRect(0, 0, LAYOUT_CANVAS_W, LAYOUT_TOOLBAR_H);

  // "KONTAKT TOOLBAR AREA" label
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.font = '600 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('KONTAKT TOOLBAR AREA \u2014 NOT EDITABLE', LAYOUT_CANVAS_W / 2, LAYOUT_TOOLBAR_H / 2);
};

LayoutBuilder.prototype._drawHeader = function(ctx) {
  // Instrument name
  ctx.fillStyle = '#ededf0';
  ctx.font = '600 20px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(this.instrumentName, 20, 140);

  // "SAMPLEARCHITECT" watermark
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.font = '600 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SAMPLEARCHITECT', LAYOUT_CANVAS_W - 16, 148);

  // Separator line
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(LAYOUT_CANVAS_W, 170);
  ctx.stroke();

  // Sample count
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '400 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(this.sampleCount + ' samples', 20, 178);
};

LayoutBuilder.prototype._drawKnobs = function(ctx) {
  var self = this;

  this.knobs.forEach(function(knob, i) {
    // Draw knob image (frame based on default value)
    if (self.knobImageLoaded && self.knobImage) {
      var frame = Math.round((knob.defaultValue / 100) * 127);
      frame = Math.max(0, Math.min(127, frame));
      var srcY = frame * LAYOUT_KNOB_SIZE;
      ctx.drawImage(
        self.knobImage,
        0, srcY, LAYOUT_KNOB_SIZE, LAYOUT_KNOB_SIZE,
        knob.x, knob.y, LAYOUT_KNOB_SIZE, LAYOUT_KNOB_SIZE
      );
    } else {
      // Fallback circle
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.arc(knob.x + LAYOUT_KNOB_SIZE / 2, knob.y + LAYOUT_KNOB_SIZE / 2, LAYOUT_KNOB_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Highlight while dragging
    if (self.dragging === i) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(knob.x - 1, knob.y - 1, LAYOUT_KNOB_SIZE + 2, LAYOUT_KNOB_SIZE + 2);
    }

    // Label below knob
    var labelX = knob.x + LAYOUT_LABEL_OFFSET_X;
    var labelY = knob.y + LAYOUT_LABEL_OFFSET_Y;

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 8px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(knob.label, knob.x + LAYOUT_KNOB_SIZE / 2, labelY);
  });
};

LayoutBuilder.prototype._drawFxChain = function(ctx) {
  if (this.fxChain.length === 0) return;

  var y = LAYOUT_CANVAS_H - 30;
  var x = 20;

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = '600 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('FX CHAIN', x, y);
  x += 60;

  this.fxChain.forEach(function(fx, i) {
    if (i > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillText('\u2192', x, y);
      x += 14;
    }

    // Pill background
    var textWidth = ctx.measureText(fx.label).width;
    var pillW = textWidth + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y - 9, pillW, 18, 9);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 9px Inter, Arial, sans-serif';
    ctx.fillText(fx.label, x + 7, y);
    x += pillW + 8;
  });
};

/* ── Position API ── */

/**
 * Returns position data for all knobs.
 * Used by ksp-gen.js and dspreset-gen.js.
 */
LayoutBuilder.prototype.getPositions = function() {
  return this.knobs.map(function(k) {
    return {
      key: k.key,
      label: k.label,
      defaultValue: k.defaultValue,
      x: k.x,
      y: k.y,
      labelX: k.x + LAYOUT_LABEL_OFFSET_X,
      labelY: k.y + LAYOUT_LABEL_OFFSET_Y
    };
  });
};

/**
 * Returns the required UI height for set_ui_height_px.
 * Based on the lowest knob position + label space.
 */
LayoutBuilder.prototype.getRequiredHeight = function() {
  if (this.knobs.length === 0) return 320;

  var maxY = 0;
  this.knobs.forEach(function(k) {
    var bottom = k.y + LAYOUT_KNOB_SIZE + LAYOUT_LABEL_H + 10;
    if (bottom > maxY) maxY = bottom;
  });

  // Add padding for FX chain
  if (this.fxChain.length > 0) {
    maxY = Math.max(maxY, LAYOUT_CANVAS_H - 10);
  }

  // Clamp to Kontakt max
  return Math.min(Math.max(maxY, 320), LAYOUT_CANVAS_H);
};
