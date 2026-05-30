// Output writers for JSON / CSV / Markdown / TXT.
// Each takes (records, fields, meta) and returns a string.

const NEWLINE_RE = /\r?\n/g;

function stringifyCell(v, { multiline = false } = {}) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('; ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v);
  if (!multiline) s = s.replace(NEWLINE_RE, ' ').trim();
  return s;
}

// JSON: when only the `name` field is selected for shows, output a flat array
// of names. Same for diary. Otherwise, output an array of objects.
export function formatJson({ shows, diary, fields, meta }) {
  const onlyName = fields.length === 1 && fields[0].flag === 'name';
  const buildSection = (records, kind) => {
    if (onlyName) {
      return records.map((r) => {
        const extractor = fields[0][kind];
        return extractor ? extractor(r) : null;
      });
    }
    return records.map((r) => {
      const out = {};
      for (const f of fields) {
        const extractor = f[kind];
        if (!extractor) continue;
        out[f.label] = extractor(r);
      }
      return out;
    });
  };
  const payload = {
    exportedAt: meta.exportedAt,
    username: meta.username,
    fields: fields.map((f) => f.flag),
    shows: shows ? buildSection(shows, 'shows') : undefined,
    diary: diary ? buildSection(diary, 'diary') : undefined,
  };
  return JSON.stringify(payload, null, 2);
}

export function formatCsv({ records, fields, kind }) {
  const cols = fields.filter((f) => f[kind]).map((f) => f.label);
  const header = cols.join(',');
  const quote = (s) => {
    if (s == null || s === '') return '';
    s = String(s);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const rows = records.map((r) =>
    fields
      .filter((f) => f[kind])
      .map((f) => quote(stringifyCell(f[kind](r), { multiline: false })))
      .join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

export function formatMarkdown({ records, fields, kind, title }) {
  const applicable = fields.filter((f) => f[kind]);
  const cols = applicable.map((f) => f.label);
  const lines = [];
  if (title) lines.push(`# ${title}`, '');
  if (!records.length) {
    lines.push('_No records._', '');
    return lines.join('\n');
  }
  // Single-column case = plain list, easier to read than a table.
  if (cols.length === 1) {
    for (const r of records) {
      const v = applicable[0][kind](r);
      lines.push(`- ${stringifyCell(v) || '_(empty)_'}`);
    }
    lines.push('');
    return lines.join('\n');
  }
  const escape = (s) => stringifyCell(s).replace(/\|/g, '\\|');
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const r of records) {
    const row = applicable.map((f) => escape(f[kind](r)));
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatTxt({ records, fields, kind }) {
  const applicable = fields.filter((f) => f[kind]);
  if (applicable.length === 1) {
    return records.map((r) => stringifyCell(applicable[0][kind](r))).join('\n') + '\n';
  }
  return (
    records
      .map((r) =>
        applicable
          .map((f) => `${f.label}: ${stringifyCell(f[kind](r))}`)
          .join('\n'),
      )
      .join('\n---\n') + '\n'
  );
}
