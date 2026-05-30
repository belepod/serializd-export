import fs from 'node:fs';
import path from 'node:path';
import { SerializdClient, mapWithConcurrency } from './api.js';
import { resolveFields, FIELDS_BY_FLAG } from './fields.js';
import { formatJson, formatCsv, formatMarkdown, formatTxt } from './formatters.js';

const FORMAT_WRITERS = {
  json: { ext: 'json', combined: true, fn: formatJson },
  csv: { ext: 'csv', combined: false, fn: formatCsv },
  md: { ext: 'md', combined: false, fn: formatMarkdown },
  txt: { ext: 'txt', combined: false, fn: formatTxt },
};

export const SUPPORTED_FORMATS = Object.keys(FORMAT_WRITERS);

export async function runExport(opts) {
  const {
    email,
    password,
    username,
    fields: requestedFlags,
    formats,
    outputDir,
    includeShows,
    includeDiary,
    concurrency,
    logger,
  } = opts;

  const log = logger ?? (() => {});

  const fields = resolveFields(requestedFlags);
  const needsEnrich = fields.some((f) => f.needsEnrich);

  log(`User: ${username}`);
  log(`Fields: ${fields.map((f) => f.flag).join(', ')}`);
  log(`Formats: ${formats.join(', ')}`);
  log(`Enrichment needed: ${needsEnrich ? 'yes' : 'no'}`);

  const client = new SerializdClient({ log });
  log('Logging in...');
  await client.login({ email, password });
  log('  ok');

  let shows = null;
  let diary = null;

  if (includeShows) {
    log('Fetching watched shows...');
    const res = await client.fetchAllWatched(username);
    shows = res.items;
    log(`  ${shows.length} shows (api reports ${res.totalShows} shows / ${res.totalSeasons} seasons)`);
  }

  if (includeDiary) {
    log('Fetching diary...');
    diary = await client.fetchAllDiary(username);
    log(`  ${diary.length} diary entries`);
  }

  // Enrich shows with /show/{id} only if a chosen field needs it.
  if (needsEnrich && shows && shows.length) {
    log(`Enriching ${shows.length} shows (concurrency=${concurrency})...`);
    let done = 0;
    await mapWithConcurrency(shows, concurrency, async (s) => {
      try {
        s._enrich = await client.fetchShow(s.showId);
      } catch (e) {
        s._enrich = { _error: e.message };
      }
      done++;
      if (done % 10 === 0 || done === shows.length) log(`  enriched ${done}/${shows.length}`);
    });
  }

  // Cross-reference diary onto shows (for --rating, --reviews on shows).
  if (shows && diary) {
    const byShow = new Map();
    for (const d of diary) {
      if (d.showId == null) continue;
      if (!byShow.has(d.showId)) byShow.set(d.showId, []);
      byShow.get(d.showId).push(d);
    }
    for (const s of shows) {
      const entries = byShow.get(s.showId) ?? [];
      const ratings = entries.map((e) => e.rating).filter((r) => typeof r === 'number' && r > 0);
      s._allRatings = ratings;
      s._latestRating = ratings[0] ?? null;
      s._reviews = entries.map((d) => ({
        diaryId: d.id,
        dateAdded: d.dateAdded,
        backdate: d.backdate,
        rating: d.rating,
        like: d.like,
        reviewText: d.reviewText,
        seasonId: d.seasonId,
        seasonName: (d.showSeasons ?? []).find((ss) => ss.id === d.seasonId)?.name ?? null,
        episodeNumber: d.episodeNumber,
        episodeName: d.episodeName,
        isRewatch: d.isRewatch,
        isLog: d.isLog,
        containsSpoiler: d.containsSpoiler,
        tags: d.tags,
      }));
    }
  } else if (shows) {
    // No diary loaded: still allow --rating-style fields to be empty rather than undefined.
    for (const s of shows) {
      s._allRatings = [];
      s._latestRating = null;
      s._reviews = [];
    }
  }

  // Also enrich diary entries with their show's enriched metadata if needed.
  if (needsEnrich && diary && diary.length) {
    // Build map showId -> _enrich (from already-enriched shows, if any).
    const enrichByShow = new Map();
    if (shows) {
      for (const s of shows) {
        if (s._enrich) enrichByShow.set(s.showId, s._enrich);
      }
    }
    // For diary entries on shows not in watched list (rare), fetch on demand.
    const missing = [...new Set(diary.map((d) => d.showId).filter((id) => id != null && !enrichByShow.has(id)))];
    if (missing.length) {
      log(`Enriching ${missing.length} extra show(s) referenced by diary...`);
      await mapWithConcurrency(missing, concurrency, async (id) => {
        try {
          enrichByShow.set(id, await client.fetchShow(id));
        } catch (e) {
          enrichByShow.set(id, { _error: e.message });
        }
      });
    }
    for (const d of diary) {
      d._showEnrich = enrichByShow.get(d.showId) ?? null;
    }
  }

  // --- Write outputs ---
  fs.mkdirSync(outputDir, { recursive: true });
  const meta = {
    exportedAt: new Date().toISOString(),
    username,
  };
  const written = [];

  for (const fmt of formats) {
    const writer = FORMAT_WRITERS[fmt];
    if (!writer) continue;

    if (writer.combined) {
      // JSON gets a single combined file.
      const content = writer.fn({
        shows: shows ?? undefined,
        diary: diary ?? undefined,
        fields,
        meta,
      });
      const file = path.join(outputDir, `serializd-export.${writer.ext}`);
      fs.writeFileSync(file, content);
      written.push(file);
    } else {
      if (shows) {
        const content = writer.fn({
          records: shows,
          fields,
          kind: 'shows',
          title: `Serializd shows — ${username}`,
        });
        const file = path.join(outputDir, `shows.${writer.ext}`);
        fs.writeFileSync(file, content);
        written.push(file);
      }
      if (diary) {
        const content = writer.fn({
          records: diary,
          fields,
          kind: 'diary',
          title: `Serializd diary — ${username}`,
        });
        const file = path.join(outputDir, `diary.${writer.ext}`);
        fs.writeFileSync(file, content);
        written.push(file);
      }
    }
  }

  log(`\nWrote ${written.length} file(s):`);
  for (const f of written) log(`  ${path.relative(process.cwd(), f)}`);

  return {
    shows,
    diary,
    fields: fields.map((f) => f.flag),
    written,
  };
}
