import { esc, icon } from './ui.js';
import { SECTIONS } from './sections.js';

const DESCRIPTIONS = {
  topics: 'Тақырып қосу, өңдеу, ретін ауыстыру, жасыру және жариялау.',
  emblems: 'Тақырып эмблемаларының кітапханасы: 128 эмблема, 18 санат.',
  students: 'Оқушы аккаунттары және уақытша құпиясөз беру.',
  feedback: 'Оқушылардың ұсыныстары: оқу, жауап беру, күйі мен күні бойынша сүзу.',
  tests: 'Тест құру: 7 сұрақ түрі, уақыт пен ұпай, алдын ала қарау, жариялау.',
  books: 'Оқулықтар: мұқаба, PDF, сынып пен баспа, жариялау.',
  images: 'Сурет жүктеу, ауыстыру, тақырыпқа байланыстыру.',
  icons: 'Мәзір белгішелері мен кезең эмблемалары.',
  site: 'Баннер, тақырыптар, батырма мәтіндері, кезеңдер.',
  publish: 'Өзгерістерді оқушыларға жариялау және бұрынғы нұсқаға қайтару.',
};

export function dashboardView(el, _params, ctx) {
  const s = ctx.state;
  const counts = {
    topics: `${s.topics.length} тақырып · ${s.topics.filter((t) => !t.published).length} жасырын`,
    emblems: `${128 + s.emblems.length} эмблема`,
    students: 'Аккаунттар тізімі',
    feedback: s.feedback_new ? `${s.feedback_new} жаңа ұсыныс` : 'Жаңа ұсыныс жоқ',
    tests: `${s.tests.length} тест · ${s.tests.reduce((n, x) => n + x.question_count, 0)} сұрақ`,
    books: `${s.books.total} кітап · ${s.books.published} жарияланған`,
    images: `${s.files.filter((f) => f.kind === 'image').length} сурет · ${s.files.filter((f) => f.kind === 'pdf').length} PDF`,
    icons: `${Object.keys(s.icons).length} өзгертілген белгіше`,
    site: `${Object.keys(s.texts).length} өзгертілген мәтін`,
    publish: s.status.has_unpublished ? 'Жарияланбаған өзгерістер бар' : 'Барлығы жарияланған',
  };
  const missing = s.tests.filter((x) => x.live && x.problems.length);
  el.innerHTML = `
    ${
      missing.length
        ? `<div class="o-alert">${icon('cross')}<span><b>${missing.length} жарияланған тестте толық емес сұрақ бар.</b> Ондай сұрақтар оқушыларға көрсетілмейді:
            ${missing.map((x) => `<a href="/organizer/tests/${x.id}" data-link>${esc(x.title)}</a>`).join(', ')}</span></div>`
        : ''
    }
    <div class="o-dash">
      ${SECTIONS.map(
        (sec, i) => `
        <a class="o-dash-card${(sec.key === 'publish' && s.status.has_unpublished) || (sec.key === 'feedback' && s.feedback_new) ? ' is-pending' : ''}" href="${sec.href}" data-link>
          <span class="o-dash-num">${String(i + 1).padStart(2, '0')}</span>
          ${icon(sec.icon)}
          <h2>${esc(sec.label)}</h2>
          <p>${esc(DESCRIPTIONS[sec.key])}</p>
          <span class="o-dash-meta">${esc(counts[sec.key])}</span>
        </a>`,
      ).join('')}
    </div>
    <p class="o-muted o-dash-note">«Сақтау» батырмасы өзгерісті кабинетте сақтайды. Оқушылар оны «Жариялау» батырмасын басқаннан кейін көреді.</p>`;
}
