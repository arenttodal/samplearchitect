/* mapper.js — Sample-to-key mapping logic */

function assignKeyRanges(samples) {
  const mapped = samples.filter(function(s) { return s.parsed; });
  if (mapped.length === 0) return;

  var sorted = mapped.slice().sort(function(a, b) { return a.midiNote - b.midiNote; });

  // Get unique MIDI notes
  var uniqueMap = {};
  sorted.forEach(function(s) {
    if (!uniqueMap[s.midiNote]) {
      uniqueMap[s.midiNote] = s;
    }
  });
  var unique = Object.values(uniqueMap).sort(function(a, b) { return a.midiNote - b.midiNote; });

  for (var i = 0; i < unique.length; i++) {
    var prev = i > 0 ? unique[i - 1].midiNote : unique[i].midiNote - 6;
    var next = i < unique.length - 1 ? unique[i + 1].midiNote : unique[i].midiNote + 6;

    unique[i].lowKey = Math.ceil((prev + unique[i].midiNote) / 2);
    unique[i].highKey = Math.floor((unique[i].midiNote + next) / 2);
    unique[i].rootKey = unique[i].midiNote;

    if (i > 0 && unique[i].lowKey <= unique[i - 1].highKey) {
      unique[i].lowKey = unique[i - 1].highKey + 1;
    }
  }

  // Apply ranges to all samples at the same pitch
  samples.forEach(function(s) {
    if (!s.parsed) return;
    var ref = unique.find(function(u) { return u.midiNote === s.midiNote; });
    if (ref) {
      s.lowKey = ref.lowKey;
      s.highKey = ref.highKey;
      s.rootKey = ref.rootKey;
    }
  });
}

function assignVelocityRanges(samples) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  if (mapped.length === 0) return;

  // Group by midiNote + roundRobin to find velocity layers per note
  var groups = {};
  mapped.forEach(function(s) {
    var key = s.midiNote + '_rr' + s.roundRobin;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });

  Object.keys(groups).forEach(function(key) {
    var group = groups[key].sort(function(a, b) { return a.velocityLayer - b.velocityLayer; });
    var totalLayers = group.length;
    group.forEach(function(s, idx) {
      var range = getVelocityRange(idx + 1, totalLayers);
      s.velLow = range.low;
      s.velHigh = range.high;
    });
  });
}

function validateSamples(samples) {
  var errors = [];
  var warnings = [];

  var mapped = samples.filter(function(s) { return s.parsed; });
  if (mapped.length === 0) {
    errors.push(samples.length === 0
      ? 'No samples imported yet'
      : 'No sample is mapped yet — rename files to the convention or assign them manually');
  }

  // Same note + velocity + round robin + articulation would stack two zones
  var seen = {};
  mapped.forEach(function(s) {
    var key = (s.articulation || '') + '_' + s.midiNote + '_v' + s.velocityLayer + '_rr' + s.roundRobin;
    if (seen[key]) {
      errors.push('Duplicate mapping: ' + s.filename + ' and ' + seen[key]);
    } else {
      seen[key] = s.filename;
    }
  });

  // Two files with the same name would overwrite each other in the export
  var dest = {};
  mapped.forEach(function(s) {
    var key = (articulationFolder(s) + '/' + s.filename).toLowerCase();
    if (dest[key]) {
      errors.push('Two files would be exported as ' + articulationFolder(s) + '/' + s.filename + ' — rename one');
    } else {
      dest[key] = true;
    }
  });

  var unreadable = samples.filter(function(s) { return s.unreadable; });
  if (unreadable.length > 0) {
    warnings.push(unreadable.length + ' file' + (unreadable.length > 1 ? 's' : '') +
      ' can\'t be read as WAV and will be skipped: ' + unreadable.map(function(s) { return s.filename; }).join(', '));
  }

  var rates = {};
  mapped.forEach(function(s) {
    if (s.wavInfo) rates[s.wavInfo.sample_rate] = true;
  });
  var rateList = Object.keys(rates);
  if (rateList.length > 1) {
    warnings.push('Mixed sample rates (' + rateList.map(function(r) { return (r / 1000) + ' kHz'; }).join(', ') +
      ') — samplers will play them, but consistent rates are recommended');
  }

  var unmatched = samples.filter(function(s) { return !s.parsed && !s.unreadable; });
  if (unmatched.length > 0 && mapped.length > 0) {
    warnings.push(unmatched.length + ' unmatched file' + (unmatched.length > 1 ? 's' : '') +
      ' will be left out unless you assign ' + (unmatched.length > 1 ? 'them' : 'it'));
  }

  return { errors: errors, warnings: warnings };
}

function getSampleStats(samples) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  var articulations = {};
  var maxVel = 0;
  var maxRR = 0;
  var instrument = '';

  mapped.forEach(function(s) {
    if (s.articulation) articulations[s.articulation] = true;
    if (s.velocityLayer > maxVel) maxVel = s.velocityLayer;
    if (s.roundRobin > maxRR) maxRR = s.roundRobin;
    if (!instrument && s.instrument) instrument = s.instrument;
  });

  return {
    instrument: instrument,
    totalSamples: mapped.length,
    articulationList: Object.keys(articulations),
    articulationCount: Object.keys(articulations).length,
    maxVelocityLayers: maxVel,
    maxRoundRobins: maxRR
  };
}
