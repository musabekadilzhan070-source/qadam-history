import crypto from 'node:crypto';
import { all, get, run, batch } from './db.js';

// Draft = the content tables the organizer edits. Students only ever see a published
// snapshot: a JSON copy of the published part of the draft, stored in `publications`.
// Each publication also keeps a full draft dump so an older version can be restored.

const CONTENT_TABLES = ['periods', 'topics', 'tests', 'questions', 'options', 'materials', 'persons', 'settings'];

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

export async function readSetting(key, fallback) {
  const row = await get('SELECT value FROM settings WHERE key = ?', key);
  return row ? parseJson(row.value, fallback) : fallback;
}

async function dumpDraft() {
  const dump = {};
  for (const table of CONTENT_TABLES) dump[table] = await all(`SELECT * FROM ${table}`);
  return dump;
}

/** Builds what students see from a draft dump: only published, complete items. */
function snapshotFrom(dump) {
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;
  const settings = Object.fromEntries(dump.settings.map((s) => [s.key, parseJson(s.value, null)]));
  const periods = [...dump.periods].sort(byPos).map((p, i) => ({
    id: p.id,
    slug: p.slug,
    number: i + 1,
    title: p.title,
    range_label: p.range_label,
    summary: p.summary,
  }));
  const periodIds = new Set(periods.map((p) => p.id));
  const topics = dump.topics
    .filter((t) => t.published && !t.deleted && periodIds.has(t.period_id))
    .sort(byPos)
    .map((t) => ({
      id: t.id,
      period_id: t.period_id,
      slug: t.slug,
      title: t.title,
      range_label: t.range_label,
      summary: t.summary,
      body: t.body,
      key_points: parseJson(t.key_points, []),
      image_id: t.image_id ?? null,
      icon: parseJson(t.icon || 'null', null),
    }));
  const topicIds = new Set(topics.map((t) => t.id));
  const options = [...dump.options].sort(byPos);
  const questions = [...dump.questions].sort(byPos);
  const tests = dump.tests
    .filter((x) => x.published && topicIds.has(x.topic_id))
    .sort(byPos)
    .map((x) => ({
      id: x.id,
      topic_id: x.topic_id,
      title: x.title,
      questions: questions
        .filter((q) => q.test_id === x.id)
        .map((q) => ({
          id: q.id,
          text: q.text,
          explanation: q.explanation,
          image_id: q.image_id ?? null,
          options: options
            .filter((o) => o.question_id === q.id)
            .map((o) => ({ id: o.id, text: o.text, image_id: o.image_id ?? null, is_correct: Boolean(o.is_correct) })),
        }))
        // A question without options or without a correct answer cannot be graded: students never get it.
        .filter((q) => q.options.length >= 2 && q.options.some((o) => o.is_correct)),
    }))
    .filter((x) => x.questions.length > 0);
  const materials = dump.materials
    .filter((m) => m.published && (m.topic_id === null || topicIds.has(m.topic_id)))
    .sort(byPos)
    .map((m) => ({ id: m.id, topic_id: m.topic_id, title: m.title, body: m.body, image_id: m.image_id, pdf_id: m.pdf_id }));
  const persons = dump.persons
    .filter((p) => p.published && (p.topic_id === null || topicIds.has(p.topic_id)))
    .sort(byPos)
    .map((p) => ({
      id: p.id,
      topic_id: p.topic_id,
      name: p.name,
      role: p.role,
      reign: p.reign,
      biography: p.biography,
      facts: parseJson(p.facts, []),
      image_id: p.image_id,
    }));
  return { texts: settings.texts || {}, icons: settings.icons || {}, periods, topics, tests, materials, persons };
}

const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function draftStatus() {
  const snapshot = snapshotFrom(await dumpDraft());
  const latest = await get('SELECT id, hash, created_at, note FROM publications ORDER BY id DESC LIMIT 1');
  return { has_unpublished: !latest || latest.hash !== hashOf(snapshot), latest: latest || null };
}

export async function publish(note = '') {
  const dump = await dumpDraft();
  const snapshot = snapshotFrom(dump);
  const { lastInsertRowid } = await run(
    'INSERT INTO publications (note, hash, data) VALUES (?, ?, ?)',
    String(note).slice(0, 200),
    hashOf(snapshot),
    JSON.stringify({ snapshot, draft: dump }),
  );
  cache = null;
  return lastInsertRowid;
}

export async function listPublications() {
  return all('SELECT id, note, created_at, length(data) AS size FROM publications ORDER BY id DESC LIMIT 30');
}

// Child tables first, so nothing is left pointing at a removed parent.
const DELETE_ORDER = ['options', 'questions', 'tests', 'materials', 'persons'];

/**
 * Brings the draft tables back to the draft saved in an older publication. Rows are updated in
 * place (never deleted and re-inserted), because foreign keys cascade: removing a topic would
 * remove students' attempts with it. Topics missing from that version are only marked deleted.
 */
export async function restoreDraft(publicationId) {
  const row = await get('SELECT data FROM publications WHERE id = ?', publicationId);
  if (!row) return false;
  const { draft } = parseJson(row.data, {});
  if (!draft) return false;
  const idList = (table) => (draft[table] || []).map((r) => Number(r.id)).filter(Number.isInteger);
  const notIn = (ids) => (ids.length ? `id NOT IN (${ids.join(',')})` : '1');
  const statements = [
    // Free every slug first so restored topics can take theirs back without UNIQUE clashes.
    ["UPDATE topics SET slug = 'tmp-' || id || '-' || slug"],
    [`UPDATE topics SET deleted = 1, published = 0, slug = 'deleted-' || id WHERE ${notIn(idList('topics'))}`],
    ...DELETE_ORDER.map((t) => [`DELETE FROM ${t} WHERE ${notIn(idList(t))}`]),
  ];
  const keys = (draft.settings || []).map((r) => r.key);
  statements.push([`DELETE FROM settings WHERE key NOT IN (${keys.map(() => '?').join(',') || "''"})`, ...keys]);
  for (const table of CONTENT_TABLES) {
    const pk = table === 'settings' ? 'key' : 'id';
    for (const source of draft[table] || []) {
      const item = table === 'topics' ? { deleted: 0, ...source } : source;
      const cols = Object.keys(item);
      const updates = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
      statements.push([
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(${pk}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
        ...cols.map((c) => item[c]),
      ]);
    }
  }
  await batch(statements);
  return true;
}

let cache = null;

/** The latest published snapshot, cached per process and re-read when a newer publication exists. */
export async function published() {
  const latest = await get('SELECT id FROM publications ORDER BY id DESC LIMIT 1');
  if (!latest) return snapshotFrom(await dumpDraft());
  if (cache?.id !== latest.id) {
    const row = await get('SELECT data FROM publications WHERE id = ?', latest.id);
    cache = { id: latest.id, snapshot: parseJson(row.data, {}).snapshot };
  }
  return cache.snapshot;
}

export async function ensureFirstPublication() {
  if (!(await get('SELECT 1 AS ok FROM publications LIMIT 1'))) await publish('Бастапқы нұсқа');
}
