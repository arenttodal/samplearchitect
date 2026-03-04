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
    if (s.articulation) articulations[s.articulation] = true;
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
    var destFolder = s.articulation || 'Uncategorized';
    var destPath = targetBase + '/Samples/' + destFolder + '/' + s.filename;

    if (s.trimApproved && s.trimStartSample != null && s.silenceRemoved > 0.01) {
      console.log('Exporting ' + s.filename + ': trimApproved=true, trimStartSample=' + s.trimStartSample);
      var rawBytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: s.path });
      await exportTrimmedSample(rawBytes, s.trimStartSample, destPath);
    } else {
      console.log('Exporting ' + s.filename + ': raw copy');
      await window.__TAURI__.core.invoke('copy_file', { src: s.path, dest: destPath });
    }
  }
}

async function exportInstrument(samples, stats, config, outputDir, onProgress) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  var instrumentName = stats.instrument || 'Instrument';
  var formats = getEnabledFormats();
  var doKontakt = formats.indexOf('kontakt') !== -1;
  var doDS = formats.indexOf('decentsampler') !== -1;
  var doBoth = doKontakt && doDS;

  var basePath = outputDir;

  // Determine sub-paths
  var kontaktPath = doBoth ? basePath + '/Kontakt' : basePath;
  var dsPath = doBoth ? basePath + '/Decent Sampler' : basePath;

  var totalStages = 10;
  var stageIdx = 0;

  function progress(label) {
    onProgress(stageIdx, label);
    stageIdx++;
  }

  // ── Stage: Create folder structure ──
  progress('Creating folder structure');
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
    var wallpaperBytes = await generateWallpaper(instrumentName, mapped.length);
    await window.__TAURI__.core.invoke('write_file_bytes', {
      path: kontaktPath + '/Resources/pictures/wallpaper.png',
      bytes: Array.from(wallpaperBytes)
    });
    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/pictures/wallpaper.txt',
      contents: generatePictureTxt(0)
    });

    var knobBytes = getKnobPngBytes();
    await window.__TAURI__.core.invoke('write_file_bytes', {
      path: kontaktPath + '/Resources/pictures/knob.png',
      bytes: Array.from(knobBytes)
    });
    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/pictures/knob.txt',
      contents: generatePictureTxt(128)
    });

    progress('Generating KSP script');
    var kspScript = generateKSP(mapped, stats, config);
    lastGeneratedKSP = kspScript;

    await window.__TAURI__.core.invoke('write_text_file', {
      path: kontaktPath + '/Resources/scripts/' + instrumentName + '_script.txt',
      contents: kspScript
    });
  }

  // ── Decent Sampler export ──
  if (doDS) {
    progress('Copying samples (Decent Sampler)');
    await copySamplesToFolder(mapped, dsPath);

    progress('Generating .dspreset');
    var dsXml = generateDspreset(mapped, stats, config, instrumentName);
    await window.__TAURI__.core.invoke('write_text_file', {
      path: dsPath + '/' + instrumentName + '.dspreset',
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
  var enabledCtrls = getEnabledControls().map(function(c) { return c.config.label; });
  var doKontakt = !formats || formats.indexOf('kontakt') !== -1;
  var doDS = !formats || formats.indexOf('decentsampler') !== -1;
  var doBoth = doKontakt && doDS;

  // Build sample map table
  var tableLines = [];
  samples.forEach(function(s) {
    if (!s.parsed) return;
    var noteName = formatNoteName(s.note, s.accidental, s.octave);
    tableLines.push(
      s.filename.padEnd(45) +
      noteName.padEnd(6) +
      ('v' + s.velocityLayer).padEnd(5) +
      ('rr' + s.roundRobin).padEnd(5) +
      (s.articulation || '')
    );
  });

  var guide = [
    '================================================================================',
    '  ' + instrumentName + ' \u2014 Loading Guide',
    '  Generated by SampleArchitect',
    '================================================================================'
  ];

  // ── Decent Sampler section (first — it's simpler) ──
  if (doDS) {
    var dsFolder = doBoth ? 'Decent Sampler/' : '';
    guide = guide.concat([
      '',
      '',
      'LOADING INTO DECENT SAMPLER (FREE)',
      '===================================',
      '',
      '1. Install Decent Sampler (free) from decentsamples.com',
      '2. Open Decent Sampler as a plugin in your DAW or standalone',
      '3. Click File \u2192 Open or drag the .dspreset file into the window:',
      '   ' + dsFolder + instrumentName + '.dspreset',
      '4. Play!',
      '',
      'That\'s it. No configuration needed.'
    ]);
  }

  // ── Kontakt section ──
  if (doKontakt) {
    var ktFolder = doBoth ? 'Kontakt/' : '';
    guide = guide.concat([
      '',
      '',
      'LOADING INTO KONTAKT 6+',
      '========================',
      '',
      '1. Open Kontakt (standalone or as a plugin in your DAW)',
      '',
      '2. Create a new empty instrument:',
      '   - Go to File > New Instrument',
      '   - Or right-click in the instrument rack and select "New Instrument"',
      '',
      '3. Open the Mapping Editor:',
      '   - Click the wrench icon to enter Instrument Edit Mode',
      '   - The Mapping Editor panel should be visible at the bottom',
      '',
      '4. Drag ALL sample files into the Mapping Editor:',
      '   - Navigate to the ' + ktFolder + 'Samples/ folder in this export',
      '   - Select ALL .wav files across all articulation subfolders',
      '   - Drag them into the Mapping Editor zone area',
      '   - Kontakt will auto-map them by reading note names from the filenames',
      '',
      '5. Verify the auto-mapping:',
      '   - In the Mapping Editor, check that each zone\'s Root Key matches',
      '     the note in the filename (e.g. Kantele_Plucked_C3_v1_rr1 \u2192 C3)',
      '   - Adjust any incorrect mappings manually if needed',
      '',
      '6. Link the Resource Container:',
      '   - In the Instrument Header, click the wrench icon for Instrument Options',
      '   - Go to the "Instrument Options" dialog',
      '   - Set the "Resource Container" path to the Resources/ folder:',
      '     ' + (outputPath ? outputPath + '/' + ktFolder + 'Resources' : ktFolder + 'Resources/'),
      '   - This loads the custom wallpaper and knob skin automatically',
      '',
      '7. Open the Script Editor:',
      '   - Click the "Script" tab (scroll icon) in the instrument header',
      '   - Click on an empty script slot (e.g., "Script 1")',
      '   - Click "Edit" to open the code editor',
      '',
      '8. Paste the KSP script:',
      '   - Use the "Copy Script to Clipboard" button in SampleArchitect',
      '   - Or open: ' + ktFolder + 'Resources/scripts/' + instrumentName + '_script.txt',
      '   - Select ALL the text (Ctrl+A / Cmd+A) and copy it',
      '   - Paste into the Kontakt Script Editor (Ctrl+V / Cmd+V)',
      '   - Click "Apply"',
      '',
      '9. Save your instrument:',
      '    - File > Save As...',
      '    - Choose a location and name',
      '    - The instrument is now saved as a .nki file',
      '',
      '10. Play!'
    ]);
  }

  // ── Instrument details ──
  guide = guide.concat([
    '',
    '',
    'INSTRUMENT DETAILS',
    '==================',
    '',
    'Name:           ' + instrumentName,
    'Samples:        ' + stats.totalSamples,
    'Articulations:  ' + stats.articulationList.join(', '),
    'Velocity Layers: ' + stats.maxVelocityLayers,
    'Round Robins:   ' + stats.maxRoundRobins,
    'Controls:       ' + (enabledCtrls.length > 0 ? enabledCtrls.join(', ') : 'None'),
    '',
    '',
    'SAMPLE MAP',
    '==========',
    '',
    'Filename'.padEnd(45) + 'Note'.padEnd(6) + 'Vel'.padEnd(5) + 'RR'.padEnd(5) + 'Articulation',
    '-'.repeat(80)
  ]).concat(tableLines).concat([
    '',
    '',
    '================================================================================',
    '  Generated by SampleArchitect v1.2 | evenant.com',
    '================================================================================'
  ]);

  return guide.join('\n');
}
