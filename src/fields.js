// Field registry. Each field declares:
//   - flag:     the CLI flag (without leading --)
//   - aliases:  comma-equivalents for --fields=name,id
//   - label:    column header for CSV / heading for MD
//   - shows:    extractor for a watched-show record, or null if not applicable
//   - diary:    extractor for a diary entry, or null if not applicable
//   - needsEnrich: requires per-show /api/show/{id} call
//
// Conventions:
//   - Always include the `name` field (no-flag default).
//   - Extractors return primitives, arrays, or null. Formatters handle stringification.

import { showUrl } from './api.js';

export const FIELDS = [
  {
    flag: 'name',
    label: 'name',
    shows: (s) => s.showName ?? null,
    diary: (d) => d.showName ?? null,
  },
  {
    flag: 'id',
    label: 'showId',
    shows: (s) => s.showId ?? null,
    diary: (d) => d.showId ?? null,
  },
  {
    flag: 'url',
    label: 'url',
    shows: (s) => showUrl(s.showName, s.showId),
    diary: (d) => showUrl(d.showName, d.showId),
  },
  {
    flag: 'date-added',
    label: 'dateAdded',
    shows: (s) => s.dateAdded ?? null,
    diary: (d) => d.dateAdded ?? null,
  },
  {
    flag: 'premiere-date',
    label: 'premiereDate',
    shows: (s) => s.premiereDate ?? null,
    diary: (d) => d._showEnrich?.premiereDate ?? d.showPremiereDate ?? null,
  },
  {
    flag: 'last-air-date',
    label: 'lastAirDate',
    needsEnrich: true,
    shows: (s) => s._enrich?.lastAirDate ?? null,
    diary: (d) => d._showEnrich?.lastAirDate ?? null,
  },
  {
    flag: 'status',
    label: 'status',
    needsEnrich: true,
    shows: (s) => s._enrich?.status ?? null,
    diary: (d) => d._showEnrich?.status ?? null,
  },
  {
    flag: 'num-seasons',
    label: 'numSeasons',
    shows: (s) => s.numSeasons ?? null,
    diary: null,
  },
  {
    flag: 'num-episodes',
    label: 'numEpisodes',
    shows: (s) => s.numEpisodes ?? null,
    diary: null,
  },
  {
    flag: 'seasons-watched',
    label: 'seasonsWatched',
    shows: (s) => s.seasonIds ?? [],
    diary: null,
  },
  {
    flag: 'seasons-watched-count',
    label: 'seasonsWatchedCount',
    shows: (s) => (s.seasonIds ?? []).length,
    diary: null,
  },
  {
    flag: 'seasons-detail',
    label: 'seasonsWatchedDetail',
    needsEnrich: true,
    shows: (s) => {
      const all = s._enrich?.seasons ?? [];
      const set = new Set(s.seasonIds ?? []);
      return all
        .filter((sn) => set.has(sn.id ?? sn.seasonId))
        .map((sn) => ({
          seasonId: sn.id ?? sn.seasonId,
          seasonNumber: sn.seasonNumber,
          name: sn.name,
          episodeCount: sn.episodeCount,
          airDate: sn.airDate,
        }));
    },
    diary: null,
  },
  {
    flag: 'genres',
    label: 'genres',
    needsEnrich: true,
    shows: (s) => (s._enrich?.genres ?? []).map((g) => g?.name ?? g).filter(Boolean),
    diary: (d) => (d._showEnrich?.genres ?? []).map((g) => g?.name ?? g).filter(Boolean),
  },
  {
    flag: 'networks',
    label: 'networks',
    needsEnrich: true,
    shows: (s) => (s._enrich?.networks ?? []).map((n) => n?.name ?? n).filter(Boolean),
    diary: (d) => (d._showEnrich?.networks ?? []).map((n) => n?.name ?? n).filter(Boolean),
  },
  {
    flag: 'tagline',
    label: 'tagline',
    needsEnrich: true,
    shows: (s) => s._enrich?.tagline ?? null,
    diary: null,
  },
  {
    flag: 'summary',
    label: 'summary',
    needsEnrich: true,
    shows: (s) => s._enrich?.summary ?? null,
    diary: null,
  },
  {
    flag: 'banner',
    label: 'bannerImage',
    shows: (s) => s.bannerImage ?? null,
    diary: (d) => d.showBannerImage ?? null,
  },
  {
    flag: 'rating',
    label: 'rating',
    shows: (s) => s._latestRating ?? null,
    diary: (d) => d.rating ?? null,
  },
  {
    flag: 'all-ratings',
    label: 'allRatings',
    shows: (s) => s._allRatings ?? [],
    diary: null,
  },
  {
    flag: 'reviews',
    label: 'reviews',
    shows: (s) => s._reviews ?? [],
    diary: null,
  },
  {
    flag: 'review-text',
    label: 'reviewText',
    shows: null,
    diary: (d) => d.reviewText ?? null,
  },
  {
    flag: 'episode',
    label: 'episode',
    shows: null,
    diary: (d) => {
      if (d.episodeNumber == null && !d.episodeName) return null;
      return {
        episodeNumber: d.episodeNumber,
        episodeName: d.episodeName,
      };
    },
  },
  {
    flag: 'season',
    label: 'season',
    shows: null,
    diary: (d) => {
      const ss = (d.showSeasons ?? []).find((s) => s.id === d.seasonId);
      if (!ss) return d.seasonId ? { seasonId: d.seasonId } : null;
      return { seasonId: ss.id, seasonNumber: ss.seasonNumber, name: ss.name };
    },
  },
  {
    flag: 'rewatch',
    label: 'isRewatch',
    shows: null,
    diary: (d) => d.isRewatch ?? false,
  },
  {
    flag: 'log',
    label: 'isLog',
    shows: null,
    diary: (d) => d.isLog ?? false,
  },
  {
    flag: 'spoiler',
    label: 'containsSpoiler',
    shows: null,
    diary: (d) => d.containsSpoiler ?? false,
  },
  {
    flag: 'tags',
    label: 'tags',
    shows: null,
    diary: (d) => d.tags ?? [],
  },
];

export const FIELDS_BY_FLAG = new Map(FIELDS.map((f) => [f.flag, f]));

export const ALL_FLAGS = FIELDS.map((f) => f.flag);

// Resolve user input (flag names) → ordered list of Field objects, with `name`
// always first if not explicitly placed elsewhere.
export function resolveFields(requestedFlags) {
  const requested = new Set(requestedFlags);
  requested.add('name'); // name is always present
  const ordered = [];
  // Preserve the canonical FIELDS order so output columns are predictable.
  for (const f of FIELDS) {
    if (requested.has(f.flag)) ordered.push(f);
  }
  return ordered;
}

// Project a single record (show or diary entry) onto the selected fields.
export function projectRecord(record, fields, kind /* 'shows' | 'diary' */) {
  const out = {};
  for (const f of fields) {
    const extractor = f[kind];
    if (!extractor) continue; // field not applicable to this kind
    const v = extractor(record);
    out[f.label] = v;
  }
  return out;
}
