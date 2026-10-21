# QADAM-ды Vercel + Turso арқылы жариялау

## Жоба қалай құрылған

- **Сайт** (`public/`): дайын HTML, CSS және JavaScript. Build қадамы жоқ, Vercel бұл папканы CDN арқылы береді.
- **API** (`api/index.js` → `server/app.js`): Node.js + Express. Vercel оны serverless функция ретінде іске қосады.
- **Дерекқор**: libSQL. Production ортада — **Turso** (бұлттағы SQLite), компьютерде — `data/qadam.sqlite` файлы.
- `vercel.json`: `/api/*` сұраныстарын API-ға, қалған беттерді `index.html`-ге бағыттайды, қауіпсіздік тақырыптарын қосады.

Бірінші сұраныста сервер кестелерді өзі құрып, дерекқор бос болса 4 кезең, 10 тақырып және 50 сұрақты жүктейді. Деректер бар болса, ештеңе қайта жазылмайды.

## 1-қадам. Кодты main тармағына қосу

GitHub-та [PR #1](https://github.com/musabekadilzhan070-source/qadam-history/pull/1) ашып, **Merge pull request → Confirm merge** басыңыз.

## 2-қадам. Turso дерекқорын ашу

1. https://turso.tech сайтында GitHub аккаунтымен тіркеліңіз (тегін жоспар жеткілікті).
2. **Create Database** басыңыз. Атауы: `qadam`. Аймақ: **Frankfurt** (Vercel функциясына жақын болсын).
3. Дерекқор бетінде екі мән керек:
   - **Database URL**: `libsql://qadam-....turso.io` түрінде.
   - **Token**: **Create Token** (немесе **Generate Token**) басып, Read & Write рұқсатымен жасаңыз. Токен бір рет көрсетіледі, көшіріп алыңыз.

Бұл екі мәнді ешкімге жібермеңіз, GitHub-қа немесе кодқа жазбаңыз.

## 3-қадам. Vercel-де жариялау

1. https://vercel.com сайтына GitHub аккаунтымен кіріңіз.
2. **Add New → Project** басып, `qadam-history` репозиторийін **Import** етіңіз.
3. **Framework Preset**: `Other`. Build және Output баптауларын өзгертпеңіз, олар `vercel.json` ішінде тұр.
4. **Environment Variables** бөліміне екі айнымалы қосыңыз:
   - `TURSO_DATABASE_URL` = Turso-дағы Database URL
   - `TURSO_AUTH_TOKEN` = Turso токені
5. **Deploy** басыңыз. 1–2 минуттан кейін сайт `https://qadam-history.vercel.app` сияқты мекенжайда ашылады.

Кейін `main` тармағына жіберілген әр өзгеріс Vercel-де өзі жарияланады.

## 4-қадам. Тексеру

- Басты бетте төрт кезең карточкасы мен сандар (10 тақырып, 10 тест, 50 сұрақ) көрінуі керек.
- Тіркеліп, бір тест тапсырыңыз, сосын «Менің нәтижелерім» бетін ашыңыз.
- Қате шықса: Vercel → Project → **Logs**. `TURSO_DATABASE_URL орнатылмаған` деген жазу айнымалылардың қойылмағанын білдіреді: оларды қосып, **Redeploy** басыңыз.

## Компьютерде іске қосу

Қажет: Node.js 20 немесе жаңарақ.

```bash
npm install
npm start      # http://localhost:3000, деректер data/qadam.sqlite файлында
npm test
```

`.env` файлына `TURSO_DATABASE_URL` пен `TURSO_AUTH_TOKEN` жазсаңыз, компьютердегі сервер де Turso-мен жұмыс істейді. `.env` GitHub-қа жүктелмейді (`.gitignore`).

## Құпия деректер

Кодта кілт, пароль немесе токен жоқ. Turso мәндері тек Vercel баптауларында сақталады. `.env`, `.env*.local`, `data/` және `.vercel/` `.gitignore` ішінде.

## Балама: Render

`render.yaml` және `Dockerfile` сақталған. Render-де тұрақты диск (`DATA_DIR`) немесе Turso айнымалыларымен жұмыс істейді.
