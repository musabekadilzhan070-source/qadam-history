import { all, get, run, batch } from './db.js';
import { rowsToQuestions, duplicateKey } from './transfer.js';
import { parseTest, writeTest, uniqueSlug } from './org.js';
import { publishTests, patchPublished } from './publish.js';
import { SUBJECT, TOPIC_PUBLISHERS } from './catalog.js';

// One-time content imports shipped with the code. Each pack runs once per database (table
// content_imports) and only on the production deployment, so tests and previews never touch it.
// A topic that is already on the site (same title, or most of its questions already in one of
// its tests) is not imported again; it is only moved to the pack's period if it is elsewhere.

const TENTH_PERIODS = [
  ['ancient', 'ezhelgi-zaman', 'Ежелгі заман', 'a-pottery'],
  ['middle', 'orta-gasyr', 'Орта ғасыр', 't-turgesh-coin'],
  ['modern', 'zhana-zaman', 'Жаңа заман', 'd-signal-fire'],
  ['recent', 'kazirgi-zaman', 'Қазіргі заман', 'i-khan-shatyr'],
];

export const PACKS = [
  {
    key: 'history-8-modern-2026-11',
    period: { slug: 'zhana-zaman', title: 'Жаңа заман' },
    grade: 8,
    load: async () => (await import('./imports/history-8-modern.js')).default,
  },
  {
    // The Мектеп book of the same grade: its own topics next to the Атамұра ones, matched only
    // against topics already tagged «8-сынып | Мектеп» (the Атамұра topics have similar titles).
    key: 'history-8-mektep-2026-11',
    period: { slug: 'zhana-zaman', title: 'Жаңа заман' },
    grade: 8,
    publisher: 'Мектеп',
    icon: { kind: 'emblem', name: 'r-batyr-helmet', size: 36 },
    load: async () => (await import('./imports/history-8-mektep.js')).default,
  },
  {
    // The organizer's ask: these books are the 7th grade. «8-сынып | Атамұра» → «7-сынып | Атамұра»
    // with Абылай ханның семсері (36 px); «8-сынып | Мектеп» → «7-сынып | Мектеп».
    key: 'retag-8-to-7-2026-11',
    run: () =>
      retagGrade(8, 7, [
        { publisher: 'Атамұра', icon: { kind: 'emblem', name: 'r-ablai-sword', size: 36 } },
        { publisher: 'Мектеп' },
      ]),
  },
  {
    // Every test of «Орта ғасыр» is «6-сынып | Атамұра» (some had no tags or other ones).
    key: 'tag-orta-gasyr-6-atamura-2026-11',
    run: () => tagPeriod({ slug: 'orta-gasyr', title: 'Орта ғасыр' }, 6, 'Атамұра'),
  },
  {
    // «Қазіргі заман», «8-сынып | Атамұра»: 21 тақырып (§1–2 … §35–36). Compared only with topics
    // already tagged «8-сынып | Атамұра», so the period's older topics with similar titles stay as they are.
    key: 'history-8-modern-atamura-2026-11',
    period: { slug: 'kazirgi-zaman', title: 'Қазіргі заман' },
    grade: 8,
    publisher: 'Атамұра',
    load: async () => (await import('./imports/history-8-modern-atamura.js')).default,
  },
  {
    // Those «Қазіргі заман», «8-сынып | Атамұра» topics get «1822 жылғы Жарғы» (36 px).
    key: 'icon-kazirgi-8-atamura-charter-2026-11',
    run: () => iconPeriod({ slug: 'kazirgi-zaman', title: 'Қазіргі заман' }, 8, 'Атамұра', { kind: 'emblem', name: 'e-charter-1822', size: 36 }),
  },
  {
    // «Қазіргі заман», «8-сынып | Мектеп»: 41 тақырып (§1–2 … §60) with Жанқожа батыр (36 px).
    // Compared only with topics already tagged «8-сынып | Мектеп».
    key: 'history-8-modern-mektep-2026-11',
    period: { slug: 'kazirgi-zaman', title: 'Қазіргі заман' },
    grade: 8,
    publisher: 'Мектеп',
    icon: { kind: 'emblem', name: 'up-zhankozha', size: 36 },
    load: async () => (await import('./imports/history-8-modern-mektep.js')).default,
  },
  {
    // «Қазіргі заман», «9-сынып | Атамұра»: 32 тақырып (§1 … §32) with «Индустрияландыру: зауыт» (36 px).
    // Compared only with topics already tagged «9-сынып | Атамұра».
    key: 'history-9-modern-atamura-2026-11',
    period: { slug: 'kazirgi-zaman', title: 'Қазіргі заман' },
    grade: 9,
    publisher: 'Атамұра',
    icon: { kind: 'emblem', name: 'sv-factory', size: 36 },
    load: async () => (await import('./imports/history-9-modern-atamura.js')).default,
  },
  {
    // «Қазіргі заман», «9-сынып | Мектеп»: 46 тақырып (§1–2 … §60) with Мәңгілік алау (36 px).
    // Compared only with topics already tagged «9-сынып | Мектеп».
    key: 'history-9-modern-mektep-2026-11',
    period: { slug: 'kazirgi-zaman', title: 'Қазіргі заман' },
    grade: 9,
    publisher: 'Мектеп',
    icon: { kind: 'emblem', name: 'w-eternal-flame', size: 36 },
    load: async () => (await import('./imports/history-9-modern-mektep.js')).default,
  },
  // «10-сынып | Атамұра»: one test for each of the four periods, each with its own emblem (36 px).
  ...TENTH_PERIODS.map(([part, slug, title, emblem]) => ({
    key: `history-10-atamura-${part}-2026-11`,
    period: { slug, title },
    grade: 10,
    publisher: 'Атамұра',
    icon: { kind: 'emblem', name: emblem, size: 36 },
    load: async () => (await import('./imports/history-10-atamura.js'))[part],
  })),
  {
    // The corrected «10-сынып | Атамұра» set: its topics in the four periods, with the same four emblems.
    // One pack, the periods one after another (parallel packs on several cold starts collided on question ids).
    key: 'history-10-atamura-topics-2026-11',
    run: async () => importByPeriod(await import('./imports/history-10-atamura-topics.js'), 10, 'Атамұра', TENTH_PERIODS),
  },
  {
    // «10-сынып | Мектеп»: its topics in the four periods («Жалпы тақырып» first in Ежелгі заман), each period its emblem (36 px).
    key: 'history-10-mektep-topics-2026-11',
    run: async () =>
      importByPeriod(await import('./imports/history-10-mektep-topics.js'), 10, 'Мектеп', [
        ['ancient', 'ezhelgi-zaman', 'Ежелгі заман', 'a-hand-axe'],
        ['middle', 'orta-gasyr', 'Орта ғасыр', 't-kultegin'],
        ['modern', 'zhana-zaman', 'Жаңа заман', 'r-dombra'],
        ['recent', 'kazirgi-zaman', 'Қазіргі заман', 'al-masa'],
      ]),
  },
  {
    key: 'history-11-atamura-topics-2026-11',
    run: async () =>
      importByPeriod(await import('./imports/history-11-atamura-topics.js'), 11, 'Атамұра', [
        ['modern', 'zhana-zaman', 'Жаңа заман', 'd-shield'],
        ['recent', 'kazirgi-zaman', 'Қазіргі заман', 'up-torch'],
      ]),
  },
];

/** One book over the four periods: the periods one after another (parallel packs collided on question ids). */
async function importByPeriod(data, grade, publisher, periods) {
  const reports = [];
  for (const [part, slug, title, emblem] of periods) {
    const pack = {
      key: `by-period-${grade}-${publisher}-${part}`,
      period: { slug, title },
      grade,
      publisher,
      samePeriod: true,
      icon: { kind: 'emblem', name: emblem, size: 36 },
      load: async () => data[part],
    };
    reports.push(await importPack(pack));
  }
  return reports;
}

// Vercel sets VERCEL_ENV during the build too: `npm run check` clears VERCEL, so test databases never import.
const enabled = () => process.env.QADAM_IMPORTS === '1' || (process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production');

// Titles compared without the «§1–2.» prefix, case, punctuation and Latin/Cyrillic look-alikes (ХVІІІ = XVIII).
const LOOKALIKE = { х: 'x', і: 'i', в: 'v', с: 'c', о: 'o', а: 'a', е: 'e', р: 'p' };
export const titleKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/^\s*§\s*[\d\s–—-]+\.?\s*/u, '')
    .replace(/[хівсоаер]/gu, (c) => LOOKALIKE[c])
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Runs every pack that has not run on this database yet. Never throws: the site keeps working. */
export async function runImportsOnce(only = null) {
  if (!enabled()) return;
  try {
    await runPacks(only ? PACKS.filter((p) => only.includes(p.key)) : PACKS);
  } catch (err) {
    console.error('[import] skipped:', err);
  }
}

async function runPacks(packs) {
  for (const pack of packs) {
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
      const report = pack.run ? await pack.run() : await importPack(pack, before);
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

  let topics = await all('SELECT id, period_id, title, grade, publisher FROM topics WHERE deleted = 0');
  let tests = await all('SELECT id, topic_id, title FROM tests');
  if (pack.publisher) {
    // A pack of one book compares itself only with that book's topics.
    topics = topics.filter((t) => t.grade === pack.grade && t.publisher === pack.publisher);
    // One book over several periods repeats titles (§1–2 in each period): compare within the period only.
    if (pack.samePeriod) topics = topics.filter((t) => t.period_id === period.id);
    const mine = new Set(topics.map((t) => t.id));
    tests = tests.filter((x) => mine.has(x.topic_id));
  }
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
      // samePeriod: only a test of the same title counts (the period's earlier one-test version shares questions).
      if ((!pack.samePeriod && overlap >= Math.ceil(keys.length / 2)) || (titleKey(x.title) === key && overlap > 0)) {
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
  let publisher = pack.publisher || mostCommon(tagged.filter((t) => t.grade === pack.grade).map((t) => t.publisher));
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
          `INSERT INTO topics (period_id, slug, position, title, range_label, summary, body, key_points, published, grade, publisher, icon)
           VALUES (?, ?, ?, ?, '', ?, '', '[]', 1, ?, ?, ?)`,
          period.id,
          slug,
          position,
          item.title,
          `${SUBJECT}, ${pack.grade}-сынып, ${item.section}.`,
          pack.grade,
          publisher,
          pack.icon ? JSON.stringify(pack.icon) : '',
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

/**
 * Moves every topic and test of one grade and publisher to another grade, on the draft and on
 * what students see, without publishing anything else. A test counts by its own tags, or its
 * topic's when it has none (as on the site). A topic gets the emblem when it is of that
 * publisher, or when all its tests are.
 */
export async function retagGrade(from, to, books) {
  const topics = await all('SELECT id, grade, publisher FROM topics WHERE deleted = 0');
  const tests = await all('SELECT id, topic_id, grade, publisher FROM tests');
  const topicOf = new Map(topics.map((t) => [t.id, t]));
  const tagsOf = (x) => {
    const t = topicOf.get(x.topic_id);
    return { grade: x.grade || t?.grade || null, publisher: x.publisher || t?.publisher || '' };
  };
  const report = { from, to, books: [] };
  const statements = [];
  const patches = [];
  for (const book of books) {
    const testIds = tests.filter((x) => tagsOf(x).grade === from && tagsOf(x).publisher === book.publisher).map((x) => x.id);
    const topicIds = topics.filter((t) => t.grade === from && t.publisher === book.publisher).map((t) => t.id);
    const mine = new Set(testIds);
    const iconTopics = book.icon
      ? topics
          .filter((t) => {
            if (topicIds.includes(t.id)) return true;
            const own = tests.filter((x) => x.topic_id === t.id);
            return own.length && own.every((x) => mine.has(x.id));
          })
          .map((t) => t.id)
      : [];
    if (topicIds.length) statements.push([`UPDATE topics SET grade = ? WHERE id IN (${topicIds.join(',')})`, to]);
    if (testIds.length) statements.push([`UPDATE tests SET grade = ? WHERE id IN (${testIds.join(',')})`, to]);
    if (iconTopics.length) statements.push([`UPDATE topics SET icon = ? WHERE id IN (${iconTopics.join(',')})`, JSON.stringify(book.icon)]);
    patches.push({ testIds: mine, topicIds: new Set(topicIds), iconTopics: new Set(iconTopics), icon: book.icon });
    report.books.push({ publisher: book.publisher, topics: topicIds.length, tests: testIds.length, icons: iconTopics.length });
  }
  if (statements.length) await batch(statements);
  await patchPublished((snap) => {
    for (const p of patches) {
      for (const t of snap.topics) {
        if (p.topicIds.has(t.id)) t.grade = to;
        if (p.iconTopics.has(t.id)) t.icon = p.icon;
      }
      for (const x of snap.tests) if (p.testIds.has(x.id)) x.grade = to;
    }
  }, `Сынып ауыстырылды: ${from}-сынып → ${to}-сынып (${books.map((b) => b.publisher).join(', ')})`);
  return report;
}

/**
 * Puts every topic and test of a period on one grade and publisher, on the draft and on what
 * students see (nothing else is published). The period's books of that grade and publisher get
 * all its tests, so none is left out of the book.
 */
export async function tagPeriod(where, grade, publisher) {
  const period = (await get('SELECT id FROM periods WHERE slug = ?', where.slug)) || (await get('SELECT id FROM periods WHERE title = ?', where.title));
  if (!period) throw new Error(`Кезең табылмады: ${where.title}`);
  const topicIds = (await all('SELECT id FROM topics WHERE period_id = ? AND deleted = 0', period.id)).map((t) => t.id);
  const testIds = topicIds.length ? (await all(`SELECT id FROM tests WHERE topic_id IN (${topicIds.join(',')})`)).map((x) => x.id) : [];
  const statements = [];
  if (topicIds.length) statements.push([`UPDATE topics SET grade = ?, publisher = ? WHERE id IN (${topicIds.join(',')})`, grade, publisher]);
  if (testIds.length) statements.push([`UPDATE tests SET grade = ?, publisher = ? WHERE id IN (${testIds.join(',')})`, grade, publisher]);
  const entries = await all(
    'SELECT e.id FROM period_books e JOIN books b ON b.id = e.book_id WHERE e.period_id = ? AND b.grade = ? AND b.publisher = ?',
    period.id,
    grade,
    publisher,
  );
  for (const e of entries) for (const t of testIds) statements.push(['INSERT OR IGNORE INTO period_book_tests (entry_id, test_id) VALUES (?, ?)', e.id, t]);
  if (statements.length) await batch(statements);
  const topicSet = new Set(topicIds);
  const testSet = new Set(testIds);
  await patchPublished((snap) => {
    for (const t of snap.topics) if (topicSet.has(t.id)) Object.assign(t, { grade, publisher });
    for (const x of snap.tests) if (testSet.has(x.id)) Object.assign(x, { grade, publisher });
  }, `${where.title}: барлық тест ${grade}-сынып | ${publisher}`);
  return { period: where.title, grade, publisher, topics: topicIds.length, tests: testIds.length, shelf_entries: entries.length };
}

/** Sets one emblem on every topic of a period with the given grade and publisher, on the draft and live at once. */
export async function iconPeriod(where, grade, publisher, icon) {
  const period = (await get('SELECT id FROM periods WHERE slug = ?', where.slug)) || (await get('SELECT id FROM periods WHERE title = ?', where.title));
  if (!period) throw new Error(`Кезең табылмады: ${where.title}`);
  const ids = (await all('SELECT id FROM topics WHERE period_id = ? AND deleted = 0 AND grade = ? AND publisher = ?', period.id, grade, publisher)).map((t) => t.id);
  const value = JSON.stringify(icon);
  if (ids.length) await run(`UPDATE topics SET icon = ? WHERE id IN (${ids.join(',')})`, value);
  const set = new Set(ids);
  await patchPublished((snap) => {
    for (const t of snap.topics) if (set.has(t.id)) t.icon = icon;
  }, `${where.title}, ${grade}-сынып | ${publisher}: белгіше ${icon.name}`);
  return { period: where.title, grade, publisher, icon, topics: ids.length };
}
