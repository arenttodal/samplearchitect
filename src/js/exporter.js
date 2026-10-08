/* exporter.js — Folder structure + file writer */
/* V1.2: Dual export — Kontakt + Decent Sampler */

/* Stores the last generated KSP script for clipboard copy */
var lastGeneratedKSP = '';

/**
 * Generate a Kontakt picture property .txt file.
 * Exact format required by Kontakt resource container.
 * LF line endings, trailing empty line.
 */
function generatePictureTxt(numAnimations) {
  return [
    'Has Alpha Channel: yes',
    'Number of Animations: ' + numAnimations,
    'Horizontal Animation: no',
    'Vertical Resizable: no',
    'Horizontal Resizable: no',
    'Fixed Top: 0',
    'Fixed Bottom: 0',
    'Fixed Left: 0',
    'Fixed Right: 0',
    ''
  ].join('\n');
}

/**
 * Copy/trim samples into a Samples/ folder at targetBase.
 * Creates articulation subfolders.
 */
async function copySamplesToFolder(mapped, targetBase) {
  var articulations = {};
  mapped.forEach(function(s) {
    articulations[articulationFolder(s)] = true;
  });
  await window.__TAURI__.core.invoke('create_directory', { path: targetBase + '/Samples' });
  var artList = Object.keys(articulations);
  for (var a = 0; a < artList.length; a++) {
    await window.__TAURI__.core.invoke('create_directory', {
      path: targetBase + '/Samples/' + artList[a]
    });
  }

  for (var i = 0; i < mapped.length; i++) {
    var s = mapped[i];
    var destFolder = articulationFolder(s);
    var destPath = targetBase + '/Samples/' + destFolder + '/' + s.filename;

    if (s.trimApproved && s.trimStartSample != null && s.silenceRemoved > 0.01) {
      var rawBytes = await readFileBytes(s.path);
      await exportTrimmedSample(rawBytes, s.trimStartSample, destPath);
    } else {
      await window.__TAURI__.core.invoke('copy_file', { src: s.path, dest: destPath });
    }
  }
}

async function exportInstrument(samples, stats, config, outputDir, onProgress) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  var instrumentName = stats.instrument || 'Instrument';
  var fileBase = safePathSegment(instrumentName, 'Instrument');
  var formats = getEnabledFormats();
  var doKontakt = formats.indexOf('kontakt') !== -1;
  var doDS = formats.indexOf('decentsampler') !== -1;
  var doBoth = doKontakt && doDS;

  // Get builder positions from app state
  var positions = (typeof state !== 'undefined' && state.knobPositions) ? state.knobPositions : null;
  var uiHeight = (typeof state !== 'undefined' && state.uiHeight) ? state.uiHeight : null;

  var basePath = outputDir;

  // Determine sub-paths
  var kontaktPath = doBoth ? basePath + '/Kontakt' : basePath;
  var dsPath = doBoth ? basePath + '/Decent Sampler' : basePath;

  var totalStages = 3 + (doKontakt ? 3 : 0) + (doDS ? 2 : 0);
  var stageIdx = 0;

  function progress(label) {
    onProgress(stageIdx, label, totalStages);
    stageIdx++;
  }

  // ── Stage: Create folder structure ──
  progress('Creating folder structure');
  await window.__TAURI__.core.invoke('create_directory', { path: basePath });
  if (doBoth) {
    await window.__TAURI__.core.invoke('create_directory', { path: kontaktPath });
    await window.__TAURI__.core.invoke('create_directory', { path: dsPath });
  }

  // ── Kontakt export ──
  if (doKontakt) {
    progress('Copying samples (Kontakt)');
    await window.__TAURI__.core.invoke('create_directory', { path: kontaktPath + '/Resources' });
    await window.__TAURI__.core.invoke('create_directory', { path: kontaktPath + '/Resources/pictures' });
    await window.__TAURI__.core.invoke('create_directory', { path: kontaktPath + '/Resources/scripts' });
    await copySamplesToFolder(mapped, kontaktPath);

    progress('Generating Kontakt resources');
    var wallpaperBytes = await generateWallpaper(instrumentName, mapped.length, uiHeight);
    await writeFileBytes(kontaktPath + '/Resources/pictures/wallpaper.png', wallpaperBytes);
    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/pictures/wallpaper.txt',
      contents: generatePictureTxt(0)
    });

    var knobBytes = getKnobPngBytes();
    await writeFileBytes(kontaktPath + '/Resources/pictures/knob.png', knobBytes);
    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/pictures/knob.txt',
      contents: generatePictureTxt(128)
    });

    progress('Generating KSP script');
    var kspScript = generateKSP(mapped, stats, config, positions, uiHeight);
    lastGeneratedKSP = kspScript;

    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/scripts/' + fileBase + '_script.txt',
      contents: kspScript
    });
  }

  // ── Decent Sampler export ──
  if (doDS) {
    progress('Copying samples (Decent Sampler)');
    await copySamplesToFolder(mapped, dsPath);

    progress('Generating .dspreset');
    var dsXml = generateDspreset(mapped, stats, config, instrumentName, positions);
    await window.__TAURI__.core.invoke('write_text_file', {
      path: dsPath + '/' + fileBase + '.dspreset',
      contents: dsXml
    });
  }

  // ── Setup guide (at root level) ──
  progress('Creating setup guide');
  var guide = generateSetupGuide(mapped, stats, config, basePath, instrumentName, formats);
  await window.__TAURI__.core.invoke('write_text_file', {
    path: basePath + '/Setup Guide.txt',
    contents: guide
  });

  // ── Finalize ──
  progress('Finalizing');

  return basePath;
}

function generateSetupGuide(samples, stats, config, outputPath, instrumentName, formats) {
  instrumentName = instrumentName || stats.instrument || 'Instrument';
  var fileBase = safePathSegment(instrumentName, 'Instrument');
  var enabledCtrls = getEnabledControls().map(function(c) { return c.config.label; });
  var doKontakt = !formats || formats.indexOf('kontakt') !== -1;
  var doDS = !formats || formats.indexOf('decentsampler') !== -1;
  var doBoth = doKontakt && doDS;
  var mapped = samples.filter(function(s) { return s.parsed; });
  var multiVel = stats.maxVelocityLayers > 1;
  var multiRR = stats.maxRoundRobins > 1;
  var multiArt = stats.articulationCount > 1;

  function pad(str, n) { str = String(str); return str.length >= n ? str + ' ' : str + ' '.repeat(n - str.length); }

  // Zone table: everything needed to check or build the mapping by hand
  var nameWidth = Math.max(8, mapped.reduce(function(w, s) { return Math.max(w, s.filename.length); }, 0)) + 2;
  var tableLines = mapped.slice().sort(function(a, b) {
    return (a.articulation || '').localeCompare(b.articulation || '') ||
      a.roundRobin - b.roundRobin || a.midiNote - b.midiNote || a.velocityLayer - b.velocityLayer;
  }).map(function(s) {
    var lo = s.lowKey != null ? s.lowKey : s.midiNote;
    var hi = s.highKey != null ? s.highKey : s.midiNote;
    return pad(s.filename, nameWidth) +
      pad(formatNoteName(s.note, s.accidental, s.octave) + ' (' + s.midiNote + ')', 11) +
      pad(midiToNoteName(lo) + '-' + midiToNoteName(hi), 12) +
      pad((s.velLow != null ? s.velLow : 0) + '-' + (s.velHigh != null ? s.velHigh : 127), 9) +
      pad('rr' + s.roundRobin, 6) +
      (s.articulation || '');
  });

  var guide = [
    '================================================================================',
    '  ' + instrumentName + ' — Loading Guide',
    '  Generated by SampleArchitect',
    '================================================================================'
  ];

  // ── Decent Sampler section (first — it's simpler) ──
  if (doDS) {
    var dsFolder = doBoth ? 'Decent Sampler/' : '';
    guide = guide.concat([
      '',
      '',
      'LOADING INTO DECENT SAMPLER (FREE) — NO SETUP NEEDED',
      '====================================================',
      '',
      '1. Install Decent Sampler (free) from decentsamples.com',
      '2. Open Decent Sampler standalone or as a plugin in your DAW',
      '3. Open (or drag in) this file:',
      '   ' + dsFolder + fileBase + '.dspreset',
      '4. Play.',
      '',
      'Keep the .dspreset next to its Samples/ folder; it loads samples by relative path.'
    ]);
    if (multiArt) {
      guide.push('Switch articulations with the ARTICULATION menu in the top-right corner.');
    }
  }

  // ── Kontakt section ──
  if (doKontakt) {
    var ktFolder = doBoth ? 'Kontakt/' : '';
    guide = guide.concat([
      '',
      '',
      'LOADING INTO KONTAKT 6+',
      '=======================',
      '',
      'Kontakt instruments (.nki) can only be created inside Kontakt, so this part',
      'takes a few manual steps. The KSP script adds the knobs, skin and effects;',
      'the zone mapping is done in Kontakt\'s Mapping Editor. Menu names can differ',
      'slightly between Kontakt versions.',
      '',
      '1. Create an empty instrument',
      '   File > New instrument (or double-click empty space in the rack).',
      '   Click the wrench icon to open Instrument Edit mode.',
      '',
      '2. Bring in the samples',
      '   Open the Mapping Editor and drag the .wav files from',
      '   ' + ktFolder + 'Samples/ onto the keyboard area.'
    ]);
    if (multiRR) {
      guide = guide.concat([
        '   ROUND ROBINS: create one group per round robin (Group Editor > Edit >',
        '   Create empty group) in rr order: group 1 = rr1, group 2 = rr2, ...',
        '   Drag each round robin\'s files into its own group. The script only cycles',
        '   round robins when the instrument has exactly ' + stats.maxRoundRobins + ' groups.'
      ]);
    }
    if (multiArt) {
      guide = guide.concat([
        '   ARTICULATIONS: the script does not switch articulations in Kontakt.',
        '   Build one instrument per articulation folder, or set up keyswitches yourself.'
      ]);
    }
    guide = guide.concat([
      '',
      '3. Set root keys from the filenames (Auto-map)',
      '   Select all zones. In the Mapping Editor choose Edit > Auto-map - Setup.',
      '   Set the token that holds the note (e.g. "C3" in ' + (mapped[0] ? mapped[0].filename : 'Name_Art_C3_v1_rr1.wav') + ')',
      '   to "Set Root Key", leave the others on "Ignore", then run',
      '   Edit > Auto-map selected.',
      '   Sharps are written as "s" in filenames (Cs3 = C#3). If a sharp lands on the',
      '   wrong key, fix it by hand using the table below.',
      '',
      '4. Check key and velocity ranges against the ZONE TABLE below',
      '   Each zone should cover the "Key range" column.',
    ]);
    if (multiVel) {
      guide = guide.concat([
        '   VELOCITY LAYERS: set each zone\'s low/high velocity to the "Velocity"',
        '   column, otherwise all layers play at once.'
      ]);
    }
    guide = guide.concat([
      '',
      '5. Save the instrument once, inside ' + (ktFolder ? 'the Kontakt/ folder' : 'this folder'),
      '   File > Save as... (choose "patch only").',
      '',
      '6. Load the skin (resource container)',
      '   Instrument Options > Instrument > Resource Container: click "Create"',
      '   and point it at ' + ktFolder + 'Resources/. This loads the wallpaper and knobs.',
      '',
      '7. Add the script',
      '   Open the Script Editor (Script tab), pick an empty slot, open the editor,',
      '   and paste the full contents of',
      '   ' + ktFolder + 'Resources/scripts/' + fileBase + '_script.txt',
      '   (or use "Copy Script to Clipboard" in SampleArchitect). Click Apply.',
      '',
      '8. Save again (File > Save) and play.'
    ]);
  }

  // ── Instrument details ──
  guide = guide.concat([
    '',
    '',
    'INSTRUMENT DETAILS',
    '==================',
    '',
    'Name:            ' + instrumentName,
    'Samples:         ' + stats.totalSamples,
    'Articulations:   ' + stats.articulationList.join(', '),
    'Velocity Layers: ' + stats.maxVelocityLayers,
    'Round Robins:    ' + stats.maxRoundRobins,
    'Controls:        ' + (enabledCtrls.length > 0 ? enabledCtrls.join(', ') : 'None'),
    '',
    '',
    'ZONE TABLE',
    '==========',
    'Note names use Kontakt\'s convention: middle C (MIDI 60) = C3.',
    '',
    pad('Filename', nameWidth) + pad('Root', 11) + pad('Key range', 12) + pad('Velocity', 9) + pad('RR', 6) + 'Articulation',
    '-'.repeat(nameWidth + 11 + 12 + 9 + 6 + 12)
  ]).concat(tableLines).concat([
    '',
    '',
    'TROUBLESHOOTING',
    '===============',
    '',
    'No sound in Kontakt: make sure the samples are in the Mapping Editor (not just',
    '  the Files tab) and that MIDI reaches Kontakt.',
    'Wrong pitches: compare each zone\'s root key with the table above.',
    'Script error on Apply: paste the whole script (select all before copying).',
    '  Kontakt 6 or newer is required.',
    'Decent Sampler says a sample is missing: move the .dspreset together with',
    '  its Samples/ folder, never on its own.',
    '',
    '',
    '================================================================================',
    '  Generated by SampleArchitect v' + SA_VERSION,
    '================================================================================'
  ]);

  return guide.join('\n');
}
