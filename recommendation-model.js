function validateProfile(profile) {
  const fields = [
    ['objects', 'Objekte', 1],
    ['users', 'Aktive Benutzer', 1],
    ['locales', 'Sprachen', 1],
    ['channels', 'Ausgabekanäle', 1],
    ['attributes', 'Attribute insgesamt', 0],
    ['localized', 'Sprachabhängige Attribute', 0],
    ['scoped', 'Kanalabhängige Attribute', 0],
    ['both', 'Sprach- und kanalabhängige Attribute', 0]
  ];
  const errors = [];
  for (const [field, label, minimum] of fields) {
    if (!Number.isSafeInteger(profile[field]) || profile[field] < minimum) {
      errors.push({ field, message: `${label}: Bitte eine ganze Zahl ab ${minimum} eingeben.` });
    }
  }
  if (!Number.isFinite(profile.docKb) || profile.docKb <= 0) {
    errors.push({ field: 'docKb', message: 'Dokumentgrösse: Bitte eine Zahl grösser als 0 eingeben.' });
  }
  if (errors.length) return errors;
  if (profile.localized + profile.scoped + profile.both > profile.attributes) {
    return [{ field: 'attributes', message: 'Die aufgeteilten Attribute dürfen zusammen nicht mehr als die Gesamtzahl ergeben. Jede Kategorie wird nur einmal gezählt.' }];
  }
  const common = profile.attributes - profile.localized - profile.scoped - profile.both;
  const fieldsCount = common + profile.localized * profile.locales
    + profile.scoped * profile.channels + profile.both * profile.locales * profile.channels;
  const cells = profile.objects * fieldsCount;
  const indexGb = profile.objects * profile.docKb / 1024 / 1024;
  if (!Number.isSafeInteger(fieldsCount) || !Number.isSafeInteger(cells) || !Number.isFinite(indexGb)) {
    return [{ field: 'objects', message: 'Die Kombination ist zu gross für eine verlässliche Berechnung. Bitte die Eingaben reduzieren.' }];
  }
  return [];
}

function hostingTier(load) {
  return load < 0.5 ? 'start' : load < 0.8 ? 'business' : 'flex';
}

function searchTier(load) {
  return load < 0.6 ? 'suitable' : load < 0.9 ? 'plan' : 'upgrade';
}

function calculateRecommendation(profile) {
  const errors = validateProfile(profile);
  if (errors.length) throw new RangeError(errors.map(error => error.message).join(' '));
  const common = profile.attributes - profile.localized - profile.scoped - profile.both;
  const fields = common + profile.localized * profile.locales
    + profile.scoped * profile.channels + profile.both * profile.locales * profile.channels;
  const cells = profile.objects * fields;
  const indexGb = profile.objects * profile.docKb / 1024 / 1024;
  // Gleiche Heuristik wie im bestehenden Skalierungsrechner (index.html).
  const contributions = {
    cells: 0.40 * (cells / 10e6),
    objects: 0.25 * (profile.objects / 30000),
    users: 0.20 * (profile.users / 3),
    fields: 0.15 * (fields / 1000)
  };
  const hostingLoad = contributions.cells + contributions.objects + contributions.users + contributions.fields;
  const searchLoad = Math.max((fields / 1000) * 1.2, indexGb / 10);
  return {
    common, fields, cells, indexGb, contributions, hostingLoad, searchLoad,
    hosting: hostingTier(hostingLoad),
    search: searchTier(searchLoad),
    mappingReview: fields > 1000
  };
}
