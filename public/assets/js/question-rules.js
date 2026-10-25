// Question formats and the checks that decide whether a question can reach students.
// Shared by the server (saving, publishing, grading) and the cabinet (live hints while editing).

// The four main formats first (quiz with one or several answers, matching, chronological order), then the extra ones.
export const TYPES = ['single', 'multiple', 'matching', 'ordering', 'image', 'open', 'context'];
export const MAIN_TYPES = ['single', 'multiple', 'matching', 'ordering'];
export const CHOICE_TYPES = ['single', 'multiple', 'image'];
export const TYPE_LABELS = {
  single: 'Викторина — біржауапты',
  multiple: 'Викторина — көпжауапты',
  image: 'Суретпен берілетін сұрақ',
  matching: 'Сәйкестендіру',
  ordering: 'Хронологиялық реттілік',
  open: 'Ашық жауап',
  context: 'Контекст',
};

/** Plain-language problems that keep a question from students (empty = ready). */
export function questionProblems(q) {
  const out = [];
  if (q.type === 'context') {
    if (!String(q.data?.body || '').trim() && !q.image_id) out.push('контекст мәтіні енгізілмеген');
    if (!q.children?.length) out.push('контекске сұрақ қосылмаған');
    return out;
  }
  if (!String(q.text || '').trim()) out.push('сұрақ мәтіні бос');
  if (CHOICE_TYPES.includes(q.type)) {
    const filled = q.options.filter((o) => String(o.text || '').trim() || o.image_id);
    const right = q.options.filter((o) => o.is_correct).length;
    if (q.options.length < 2) out.push('кемінде екі жауап нұсқасы керек');
    else if (filled.length < q.options.length) out.push('бос жауап нұсқасы бар');
    if (!right) out.push('дұрыс жауап белгіленбеген');
    if (q.type === 'single' && right > 1) out.push('біржауапты викторинада тек бір жауап белгіленеді');
    if (q.type === 'image' && !q.image_id) out.push('сұрақ суреті жүктелмеген');
  } else if (q.type === 'matching') {
    const pairs = q.data.pairs || [];
    if (pairs.length < 2) out.push('кемінде екі жұп керек');
    if (pairs.some((p) => !p.left.trim() || !p.right.trim())) out.push('сәйкестендіру жұптары толық емес');
    const rights = pairs.map((p) => p.right.trim().toLowerCase());
    if (new Set(rights).size < rights.length) out.push('оң жақтағы элементтер қайталанады');
  } else if (q.type === 'ordering') {
    const items = q.data.items || [];
    if (items.length < 2) out.push('кемінде екі оқиға керек');
    if (items.some((i) => !i.text.trim())) out.push('оқиға мәтіні бос');
  } else if (q.type === 'open') {
    if (!(q.data.answers || []).some((a) => a.trim())) out.push('дұрыс жауап енгізілмеген');
  }
  return out;
}

/** Every problem in a test, labelled by question number, for the publish check. */
export function testProblems(test) {
  const out = [];
  if (!String(test.title || '').trim()) out.push('Тест атауы жазылмаған.');
  if (!test.topic_id) out.push('Тест тақырыпқа байланыстырылмаған.');
  if (!test.questions.length) out.push('Тестте әзірге сұрақ жоқ.');
  test.questions.forEach((q, i) => {
    const label = q.type === 'context' ? `${i + 1}-блок (контекст)` : `${i + 1}-сұрақ`;
    for (const p of questionProblems(q)) out.push(`${label}: ${p}.`);
    (q.children || []).forEach((c, ci) => {
      for (const p of questionProblems(c)) out.push(`${i + 1}-блоктың ${ci + 1}-сұрағы: ${p}.`);
    });
  });
  return out;
}

