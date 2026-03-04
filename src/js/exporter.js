/* exporter.js — Folder structure + file writer */
/* V1.1b: Resource container with wallpaper + knob skin */

/* Stores the last generated KSP script for clipboard copy */
var lastGeneratedKSP = '';

async function exportInstrument(samples, stats, config, outputDir, onProgress) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  var instrumentName = stats.instrument || 'Instrument';

  /* Fix 3: The save dialog returns the full target path already.
     Don't append instrumentName again — use outputDir directly as basePath. */
  var basePath = outputDir;

  var stages = [
    'Creating folder structure',
    'Organizing samples',
    'Copying sample files',
    'Copying sample files',
    'Generating resources',
    'Generating KSP script',
    'Writing script file',
    'Creating setup guide',
    'Finalizing'
  ];

  // Stage 1: Create folders (V1.1b structure)
  onProgress(0, stages[0]);
  await window.__TAURI__.core.invoke('create_directory', { path: basePath + '/Samples' });
  await window.__TAURI__.core.invoke('create_directory', { path: basePath + '/Resources' });
  await window.__TAURI__.core.invoke('create_directory', { path: basePath + '/Resources/pictures' });
  await window.__TAURI__.core.invoke('create_directory', { path: basePath + '/Resources/scripts' });

  // Create articulation subfolders
  var articulations = {};
  mapped.forEach(function(s) {
    if (s.articulation) articulations[s.articulation] = true;
  });
  var artList = Object.keys(articulations);
  for (var a = 0; a < artList.length; a++) {
    await window.__TAURI__.core.invoke('create_directory', {
      path: basePath + '/Samples/' + artList[a]
    });
  }

  // Stage 2-4: Copy/trim samples
  onProgress(1, stages[1]);
  for (var i = 0; i < mapped.length; i++) {
    var s = mapped[i];
    var destFolder = s.articulation || 'Uncategorized';
    var destPath = basePath + '/Samples/' + destFolder + '/' + s.filename;

    var stageIdx = Math.min(3, 1 + Math.floor((i / mapped.length) * 3));
    onProgress(stageIdx, stages[stageIdx]);

    // If sample has trim data, write trimmed WAV; otherwise plain copy
    if (s.trimStartSample != null && s.trimEndSample != null && s.silenceRemoved > 0.01) {
      var rawBytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: s.path });
      var trimmedBytes = trimWavBytes(rawBytes, s.trimStartSample, s.trimEndSample);
      await window.__TAURI__.core.invoke('write_file_bytes', {
        path: destPath,
        bytes: Array.from(trimmedBytes)
      });
    } else {
      await window.__TAURI__.core.invoke('copy_file', {
        src: s.path,
        dest: destPath
      });
    }
  }

  // Stage 5: Generate resource container assets (wallpaper + knob skin)
  onProgress(4, stages[4]);

  var wallpaperBytes = await generateWallpaper(instrumentName, mapped.length);
  await window.__TAURI__.core.invoke('write_file_bytes', {
    path: basePath + '/Resources/pictures/wallpaper.png',
    bytes: Array.from(wallpaperBytes)
  });
  console.log('[SampleArchitect] wallpaper.png written (' + wallpaperBytes.length + ' bytes) to ' + basePath + '/Resources/pictures/wallpaper.png');

  await window.__TAURI__.core.invoke('write_text_file', {
    path: basePath + '/Resources/pictures/wallpaper.txt',
    contents: 'has_alpha,  frames,  height, width, vert\n1,          1,       500,    633,   1\n'
  });

  var knobBytes = await generateKnobStrip();
  await window.__TAURI__.core.invoke('write_file_bytes', {
    path: basePath + '/Resources/pictures/sa_knob.png',
    bytes: Array.from(knobBytes)
  });
  console.log('[SampleArchitect] sa_knob.png written (' + knobBytes.length + ' bytes) to ' + basePath + '/Resources/pictures/sa_knob.png');

  await window.__TAURI__.core.invoke('write_text_file', {
    path: basePath + '/Resources/pictures/sa_knob.txt',
    contents: 'has_alpha,  frames,  height, width, vert\n1,          128,     54,     54,    1\n'
  });

  // Stage 6-7: Generate and write KSP script as .txt
  onProgress(5, stages[5]);
  var kspScript = generateKSP(mapped, stats, config);
  lastGeneratedKSP = kspScript;

  onProgress(6, stages[6]);
  // Write to Resources/scripts/ (primary location for resource container)
  await window.__TAURI__.core.invoke('write_text_file', {
    path: basePath + '/Resources/scripts/' + instrumentName + '_script.txt',
    contents: kspScript
  });

  // Stage 8: Setup guide
  onProgress(7, stages[7]);
  var guide = generateSetupGuide(mapped, stats, config, basePath, instrumentName);
  await window.__TAURI__.core.invoke('write_text_file', {
    path: basePath + '/Setup Guide.txt',
    contents: guide
  });

  // Stage 9: Finalize
  onProgress(8, stages[8]);

  return basePath;
}

function generateSetupGuide(samples, stats, config, outputPath, instrumentName) {
  instrumentName = instrumentName || stats.instrument || 'Instrument';
  var enabledCtrls = getEnabledControls().map(function(c) { return c.config.label; });

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
    '  ' + instrumentName + ' — Loading Guide',
    '  Generated by SampleArchitect',
    '================================================================================',
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
    '   - Navigate to the Samples/ folder in this export',
    '   - Select ALL .wav files across all articulation subfolders',
    '   - Drag them into the Mapping Editor zone area',
    '   - Kontakt will auto-map them by reading note names from the filenames',
    '',
    '5. Verify the auto-mapping:',
    '   - In the Mapping Editor, check that each zone\'s Root Key matches',
    '     the note in the filename (e.g. Kantele_Plucked_C3_v1_rr1 → C3)',
    '   - Adjust any incorrect mappings manually if needed',
    '',
    '6. Link the Resource Container:',
    '   - In the Instrument Header, click the wrench icon for Instrument Options',
    '   - Go to the "Instrument Options" dialog',
    '   - Set the "Resource Container" path to the Resources/ folder in this export:',
    '     ' + (outputPath ? outputPath + '/Resources' : 'Resources/'),
    '   - This loads the custom wallpaper and knob skin automatically',
    '',
    '7. Open the Script Editor:',
    '   - Click the "Script" tab (scroll icon) in the instrument header',
    '   - Click on an empty script slot (e.g., "Script 1")',
    '   - Click "Edit" to open the code editor',
    '',
    '8. Paste the KSP script:',
    '   - Use the "Copy Script to Clipboard" button in SampleArchitect',
    '   - Or open: Resources/scripts/' + instrumentName + '_script.txt',
    '   - Select ALL the text (Ctrl+A / Cmd+A) and copy it',
    '   - Paste into the Kontakt Script Editor (Ctrl+V / Cmd+V)',
    '   - Click "Apply"',
    '',
    '9. The script adds:',
    '   - Custom wallpaper background (rendered from Resources/pictures/wallpaper.png)',
    '   - Custom knob skins (rendered from Resources/pictures/sa_knob.png)',
    '   - UI control knobs (' + (enabledCtrls.length > 0 ? enabledCtrls.join(', ') : 'None configured') + ')',
    '   - The script does NOT remap zones — Kontakt handles that from filenames',
    '',
    '10. Save your instrument:',
    '    - File > Save As...',
    '    - Choose a location and name',
    '    - The instrument is now saved as a .nki file',
    '',
    '11. Play!',
    '    - Set up a MIDI track in your DAW pointing to this Kontakt instance',
    '    - Play notes on your MIDI controller or piano roll',
    '    - Your sampled instrument should respond to velocity and pitch',
    '',
    '',
    'RESOURCE CONTAINER',
    '==================',
    '',
    'This export includes a Resources/ folder with custom graphics:',
    '',
    '  Resources/',
    '  ├── pictures/',
    '  │   ├── wallpaper.png    (633×500 instrument background)',
    '  │   ├── wallpaper.txt    (property file for wallpaper)',
    '  │   ├── sa_knob.png      (128-frame knob strip)',
    '  │   └── sa_knob.txt      (property file for knob skin)',
    '  └── scripts/',
    '      └── ' + instrumentName + '_script.txt',
    '',
    'The KSP script references these files by name. If Kontakt shows missing',
    'graphics, re-link the Resource Container path in Instrument Options.',
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
  ].concat(tableLines).concat([
    '',
    '',
    'TROUBLESHOOTING',
    '===============',
    '',
    '"No sound when I play"',
    '> Make sure you dragged the samples into the Mapping Editor, not just the Files tab',
    '> Verify MIDI input is reaching Kontakt (check the MIDI indicator)',
    '> Check that zones are visible in the Mapping Editor',
    '',
    '"Wrong pitches"',
    '> Kontakt auto-maps from filenames. Verify the filenames follow the naming convention.',
    '> In the Mapping Editor, check each zone\'s Root Key matches the expected note.',
    '> You can manually drag zones to the correct keys if needed.',
    '',
    '"Script error on Apply"',
    '> Make sure you copied the ENTIRE script text (Ctrl+A before copying)',
    '> The script requires Kontakt 6 or newer. Kontakt 5 is not supported.',
    '> Check for stray characters at the beginning or end of the pasted text.',
    '',
    '"Missing wallpaper or knob graphics"',
    '> Re-link the Resource Container in Instrument Options (step 6 above)',
    '> Make sure the Resources/ folder is next to the Samples/ folder',
    '> The pictures/ subfolder must contain wallpaper.png and sa_knob.png',
    '',
    '',
    '================================================================================',
    '  Generated by SampleArchitect v1.1b | evenant.com',
    '================================================================================'
  ]);

  return guide.join('\n');
}
