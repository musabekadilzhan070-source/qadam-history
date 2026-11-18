import { all, get, run, batch } from './db.js';
import { rowsToQuestions, duplicateKey } from './transfer.js';
import { parseTest, writeTest, uniqueSlug } from './org.js';
import { publishTests } from './publish.js';
import { SUBJECT, TOPIC_PUBLISHERS } from './catalog.js';

// One-time content imports shipped with the code. Each pack runs once per database (table
// content_imports) and only on the production deployment, so tests and previews never touch it.
// A topic that is already on the site (same title, or most of its questions already in one of
// its tests) is not imported again; it is only moved to the pack's period if it is elsewhere.

const PACKS = [
  {
    key: 'history-8-modern-2026-11',
    period: { slug: 'zhana-zaman', title: 'Жаңа заман' },
    grade: 8,
    load: async () => (await import('./imports/history-8-modern.js')).default,
  },
];

const enabled = () => process.env.QADAM_IMPORTS === '1' || process.env.VERCEL_ENV === 'production';

// Titles compared without the «§1–2.» prefix, case, punctuation and Latin/Cyrillic look-alikes (ХVІІІ = XVIII).
const LOOKALIKE = { х: 'x', і: 'i', в: 'v', с: 'c', о: 'o', а: 'a', е: 'e', р: 'p' };
export const titleKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/^\s*§\s*[\d\s–—-]+\.?\s*/u, '')
    .replace(/[хівсоаер]/gu, (c) => LOOKALIKE[c])
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Runs every pack that has not run on this database yet. Never throws: the site keeps working. */
export async function runImportsOnce() {
  if (!enabled()) return;
  try {
    await runPacks();
  } catch (err) {
    console.error('[import] skipped:', err);
  }
}

async function runPacks() {
  for (const pack of PACKS) {
    const row = await get("SELECT status, report, (julianday('now') - julianday(created_at)) * 1440 AS minutes FROM content_imports WHERE key = ?", pack.key);
    // A run that stopped half-way (a timed-out function) is picked up again after 10 minutes.
    if (row && (row.status === 'done' || row.minutes < 10)) continue;
    const before = row ? parseReport(row.report) : null;
    // Claim the pack first, so two cold starts at once do not both import it.
    try {
      if (row) {
        const { changes } = await run(
          "UPDATE content_imports SET created_at = datetime('now') WHERE key = ? AND status = 'running' AND created_at = (SELECT created_at FROM content_imports WHERE key = ?) AND (julianday('now') - julianday(created_at)) * 1440 >= 10",
          pack.key,
          pack.key,
        );
        if (!changes) continue;
      } else await run("INSERT INTO content_imports (key, status) VALUES (?, 'running')", pack.key);
    } catch {
      continue;
    }
    try {
      const report = await importPack(pack, before);
      await run("UPDATE content_imports SET status = 'done', report = ? WHERE key = ?", JSON.stringify(report), pack.key);
      console.log(`[import] ${pack.key}`, JSON.stringify(report));
    } catch (err) {
      // Let a later cold start try again; topics made before the error are recognised then.
      await run("UPDATE content_imports SET created_at = datetime('now', '-1 hour') WHERE key = ? AND status = 'running'", pack.key).catch(() => {});
      console.error(`[import] ${pack.key} failed:`, err);
    }
  }
}

const parseReport = (text) => {
  try {
    return JSON.parse(text || 'null');
  } catch {
    return null;
  }
};

/** Imports one pack. `before` is the report of a run that stopped half-way: what it made counts as imported. */
export async function importPack(pack, before = null) {
  const period =
    (await get('SELECT id FROM periods WHERE slug = ?', pack.period.slug)) || (await get('SELECT id FROM periods WHERE title = ?', pack.period.title));
  if (!period) throw new Error(`Кезең табылмады: ${pack.period.title}`);
  const items = await pack.load();

  const topics = await all('SELECT id, period_id, title, grade, publisher FROM topics WHERE deleted = 0');
  const tests = await all('SELECT id, topic_id, title FROM tests');
  const questions = await all('SELECT test_id, type, text FROM questions WHERE parent_id IS NULL');
  const keysByTest = new Map();
  for (const q of questions) {
    if (!keysByTest.has(q.test_id)) keysByTest.set(q.test_id, new Set());
    keysByTest.get(q.test_id).add(duplicateKey(q));
  }

  const parsed = items.map((item) => {
    const { questions: qs, errors } = rowsToQuestions(item.rows);
    if (errors.length) throw new Error(`${item.section}: ${errors[0].message} (жол ${errors[0].row})`);
    return { ...item, questions: qs };
  });

  // Which topic on the site each item already is, if any.
  for (const item of parsed) {
    const key = titleKey(item.title);
    const keys = item.questions.map(duplicateKey);
    let match = topics.find((t) => titleKey(t.title) === key);
    let test = null;
    for (const x of tests) {
      const have = keysByTest.get(x.id);
      const overlap = have ? keys.filter((k) => have.has(k)).length : 0;
      if (overlap >= Math.ceil(keys.length / 2) || (titleKey(x.title) === key && overlap > 0)) {
        test = x;
        break;
      }
    }
    if (!match && test) match = topics.find((t) => t.id === test.topic_id) || null;
    item.existing = match || null;
    item.existingTest = test || (match ? tests.find((x) => x.topic_id === match.id && keysByTest.get(x.id)?.size) : null) || null;
  }

  // Grade and publisher: as the topics of this set already on the site, otherwise this period's
  // 8th-grade book on its shelf, otherwise Атамұра.
  const tagged = parsed.map((i) => i.existing).filter((t) => t?.grade && t?.publisher);
  let publisher = mostCommon(tagged.filter((t) => t.grade === pack.grade).map((t) => t.publisher));
  if (!publisher) {
    const shelf = await all(
      'SELECT DISTINCT b.publisher FROM period_books e JOIN books b ON b.id = e.book_id WHERE e.period_id = ? AND b.grade = ?',
      period.id,
      pack.grade,
    );
    if (shelf.length === 1 && TOPIC_PUBLISHERS.includes(shelf[0].publisher)) publisher = shelf[0].publisher;
  }
  publisher ||= 'Атамұра';

  const report = { period: pack.period.title, grade: pack.grade, publisher, imported: [], skipped: [], moved: [], live: 0 };
  const madeBefore = new Map((before?.made || []).map((m) => [m.label, m]));
  report.made = [];
  const save = () => run('UPDATE content_imports SET report = ? WHERE key = ?', JSON.stringify(report), pack.key);
  const newTests = [];
  const movedTopics = [];
  let position = (await get('SELECT COALESCE(MAX(position), 0) AS n FROM topics WHERE period_id = ?', period.id)).n;

  for (const item of parsed) {
    const label = `${item.section}. ${item.title}`;
    const earlier = madeBefore.get(label);
    if (earlier && (await get('SELECT 1 AS ok FROM tests WHERE id = ?', earlier.test))) {
      // Made by the run that stopped: still imported, and still to be published.
      report.made.push(earlier);
      report.imported.push(`${label} (${item.questions.length} сұрақ)`);
      newTests.push(earlier.test);
      continue;
    }
    if (item.existing && item.existingTest) {
      report.skipped.push(label);
      if (item.existing.period_id !== period.id) {
        position += 1;
        await run('UPDATE topics SET period_id = ?, position = ? WHERE id = ?', period.id, position, item.existing.id);
        movedTopics.push(item.existing.id);
        report.moved.push(label);
      }
      continue;
    }
    let topicId = item.existing?.id;
    if (topicId) {
      // The topic is there without these questions: its test is added to it.
      if (item.existing.period_id !== period.id) {
        position += 1;
        await run('UPDATE topics SET period_id = ?, position = ? WHERE id = ?', period.id, position, topicId);
        report.moved.push(label);
      }
    } else {
      position += 1;
      const slug = await uniqueSlug(item.title);
      topicId = (
        await run(
          `INSERT INTO topics (period_id, slug, position, title, range_label, summary, body, key_points, published, grade, publisher)
           VALUES (?, ?, ?, ?, '', ?, '', '[]', 1, ?, ?)`,
          period.id,
          slug,
          position,
          item.title,
          `${SUBJECT}, ${pack.grade}-сынып, ${item.section}.`,
          pack.grade,
          publisher,
        )
      ).lastInsertRowid;
    }
    const test = await parseTest({
      topic_id: topicId,
      title: item.title,
      description: '',
      grade: pack.grade,
      publisher,
      subject: SUBJECT,
      book_pages: item.section,
      settings: {},
      questions: item.questions,
    });
    const order = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM tests WHERE topic_id = ?', topicId)).n;
    const testId = Number((await run('INSERT INTO tests (topic_id, position, title, published) VALUES (?, ?, ?, 1)', topicId, order, test.title)).lastInsertRowid);
    try {
      await writeTest(testId, test);
    } catch (err) {
      await run('DELETE FROM tests WHERE id = ?', testId);
      throw err;
    }
    newTests.push(testId);
    report.made.push({ label, test: testId });
    report.imported.push(`${label} (${item.questions.length} сұрақ)`);
    await save();
  }

  // The period's books on the shelf: new tests go where this set's tests already are, otherwise
  // into the period's books of the same grade and publisher.
  if (newTests.length) {
    const made = new Set(newTests);
    const knownTests = parsed.map((i) => i.existingTest?.id).filter((id) => id && !made.has(id));
    let entries = knownTests.length
      ? await all(
          `SELECT DISTINCT e.id FROM period_books e JOIN period_book_tests pt ON pt.entry_id = e.id
           WHERE e.period_id = ? AND pt.test_id IN (${knownTests.join(',')})`,
          period.id,
        )
      : [];
    if (!entries.length) {
      entries = await all(
        'SELECT e.id FROM period_books e JOIN books b ON b.id = e.book_id WHERE e.period_id = ? AND b.grade = ? AND b.publisher = ?',
        period.id,
        pack.grade,
        publisher,
      );
    }
    const links = entries.flatMap((e) => newTests.map((t) => ['INSERT OR IGNORE INTO period_book_tests (entry_id, test_id) VALUES (?, ?)', e.id, t]));
    if (links.length) await batch(links);
    report.shelf_entries = entries.length;
  }

  if (newTests.length || movedTopics.length) {
    report.live = (await publishTests(newTests, movedTopics, `Импорт: ${pack.grade}-сынып, ${pack.period.title} (${newTests.length} тест)`)).length;
  }
  return report;
}

function mostCommon(list) {
  const count = new Map();
  for (const x of list) count.set(x, (count.get(x) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
