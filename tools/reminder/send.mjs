/* Fahrzeugpflege – Erinnerungs-E-Mails
   Läuft stündlich per GitHub Actions (.github/workflows/erinnerungen.yml).
   Ablauf:
   1. settings/reminders lesen (1 Lesezugriff). Wer hat E-Mails an, ist seine Uhrzeit erreicht, und hat heute noch keine bekommen?
   2. Nur wenn jemand dran ist: Fahrzeuge und offene Maßnahmen lesen, je Person die Liste bauen und per SMTP verschicken.
   3. Pro Person wird "heute verschickt" vermerkt – es gibt also höchstens eine E-Mail pro Tag.
   Ohne eingerichtete Geheimnisse (Secrets) passiert nichts. Mit DRY_RUN=1 wird nur ins Protokoll geschrieben. */

export const TZ = 'Europe/Vienna';
const APP_URL = process.env.APP_URL || 'https://mario4403.github.io/TQS-Fahrzeugpflege/';
const MAILRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function viennaNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const fmt = s => (s ? s.split('-').reverse().join('.') : '–');
const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAT = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const vname = v => [v.brand, v.model].filter(Boolean).join(' ') || 'Fahrzeug';

/* Wer ist jetzt dran? */
export function due(reminders, now, force = false) {
  const r = (reminders && reminders.r) || {};
  return Object.entries(r)
    .filter(([, p]) => p && p.on && MAILRE.test(p.email || '') && (force || (now.hour >= Number(p.hour ?? 6) && p.last !== now.day)))
    .map(([uid, p]) => ({ uid, ...p }));
}

/* Standort wie in der App: eingetragener Standort, sonst der erste (Standard: Mondsee) */
export const siteOf = (v, sites) => (v && v.site && sites.includes(v.site) ? v.site : sites[0]);

/* Liste der Maßnahmen für eine Person (gleiche Regeln wie in der App: aktive Fahrzeuge, nicht erledigt, nicht gelöscht, gewählter Standort) */
export function listFor(person, vehicles, tasks, today, sites = ['Mondsee']) {
  const site = person.site || '*';
  const vm = new Map(vehicles.filter(v => !v.archived && (site === '*' || siteOf(v, sites) === site)).map(v => [v.fin, { ...v, _site: siteOf(v, sites) }]));
  const overdue = person.overdue !== false;
  return tasks
    .filter(t => vm.has(t.fin) && t.status !== 'Erledigt' && !t.removed && (t.due === today || (overdue && t.due < today)))
    .map(t => ({ t, v: vm.get(t.fin) }))
    .sort((a, b) => NAT.compare(a.v._site, b.v._site) || NAT.compare(a.v.loc || '~', b.v.loc || '~') || NAT.compare(a.v.spot || '~', b.v.spot || '~') || NAT.compare(a.v.fin, b.v.fin) || (a.t.due < b.t.due ? -1 : 1));
}

/* Kategorie-Farben wie in der App */
const CATS = { b12: ['12V-Batterie', '#a26700', '#fdf1d4'], hv: ['HV-Batterie', '#a26700', '#fdf1d4'], reifen: ['Reifendruck', '#0c6fa4', '#e3f0f7'],
  bremse: ['Bremsen', '#5b4bb7', '#f1edfc'], folie: ['Folie', '#1d8a54', '#e2f4ea'], reinigung: ['Säuberung', '#1d8a54', '#e2f4ea'], sonst: ['Sonstiges', '#5f6c7a', '#edf1f5'] };
const catOf = t => (t.cat && CATS[t.cat] ? t.cat : /batter/i.test(t.title || '') ? (/hv/i.test(t.title) ? 'hv' : 'b12') : /reifen/i.test(t.title || '') ? 'reifen' : /brems/i.test(t.title || '') ? 'bremse' : /folie/i.test(t.title || '') ? 'folie' : 'sonst');
const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function buildMail(person, list, today) {
  const late = list.filter(x => x.t.due < today).length, n = list.length;
  const subject = n
    ? `Fahrzeugpflege: ${n} ${n === 1 ? 'Maßnahme' : 'Maßnahmen'} am ${fmt(today)}${late ? ` (davon ${late} überfällig)` : ''}`
    : `Fahrzeugpflege: heute (${fmt(today)}) nichts zu tun`;
  const first = String(person.name || '').trim().split(/\s+/)[0];
  const hello = first ? `Servus ${first},` : 'Servus,';
  const off = 'Du bekommst diese E-Mail, weil du in der App unter Einstellungen → Erinnerungs-E-Mails die Erinnerung eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.';
  const wd = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z'));

  /* Nach Standort/Bereich und dann nach Fahrzeug gruppieren (Reihenfolge wie im Rundgang) */
  const groups = [];
  for (const x of list) {
    const loc = (x.v._site || '') + (x.v.loc ? ` · ${x.v.loc}` : '');
    let g = groups[groups.length - 1];
    if (!g || g.loc !== loc) groups.push(g = { loc, cars: [] });
    let c = g.cars[g.cars.length - 1];
    if (!c || c.v.fin !== x.v.fin) g.cars.push(c = { v: x.v, ts: [] });
    c.ts.push(x.t);
  }
  const cars = groups.reduce((a, g) => a + g.cars.length, 0);

  /* Text-Version */
  let text = `${hello}\n\n${n ? `heute ${n === 1 ? 'ist 1 Maßnahme' : `sind ${n} Maßnahmen`} bei ${cars} ${cars === 1 ? 'Fahrzeug' : 'Fahrzeugen'} fällig${late ? `, davon ${late} überfällig` : ''}:` : 'heute steht keine Maßnahme an.'}\n`;
  for (const g of groups) {
    text += `\n== ${g.loc} ==\n`;
    for (const c of g.cars) {
      text += `\n${c.v.spot ? `[${c.v.spot}] ` : ''}${vname(c.v)}${c.v.plate ? ` · ${c.v.plate}` : ''} · ${c.v.fin}\n`;
      for (const t of c.ts) text += `  - ${t.title}${t.due < today ? ` (überfällig seit ${days(t.due, today)} ${days(t.due, today) === 1 ? 'Tag' : 'Tagen'})` : ' (heute)'}\n`;
    }
  }
  text += `\nApp öffnen: ${APP_URL}\n\n${off}\n`;

  /* HTML-Version: E-Mail-tauglich (Tabellen, Inline-Styles), helles Layout */
  const tile = (num, label, col, bg) => `<td width="33%" style="padding:0 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg};border-radius:12px"><tr><td style="padding:14px 12px;${F};text-align:center"><div style="font-size:26px;font-weight:700;color:${col};line-height:1.1">${num}</div><div style="font-size:12px;color:#5b6878;margin-top:3px">${label}</div></td></tr></table></td>`;
  let body = '';
  for (const g of groups) {
    body += `<tr><td style="padding:22px 0 8px;${F}"><span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0c6fa4">${esc(g.loc)}</span>
<span style="font-size:12px;color:#8592a0">&nbsp;·&nbsp;${g.cars.length} ${g.cars.length === 1 ? 'Fahrzeug' : 'Fahrzeuge'}</span></td></tr>`;
    for (const c of g.cars) {
      const worst = Math.max(...c.ts.map(t => (t.due < today ? days(t.due, today) : 0)));
      const items = c.ts.slice().sort((a, b) => (a.due < b.due ? -1 : 1)).map(t => {
        const k = catOf(t), [cl, col] = CATS[k], od = t.due < today ? days(t.due, today) : 0;
        return `<tr><td style="padding:5px 0;${F};font-size:14px;color:#0f1c27;vertical-align:middle">
<span title="${esc(cl)}" style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${col};margin-right:10px;vertical-align:1px"></span>${esc(t.title)}</td>
<td align="right" style="padding:5px 0;${F};font-size:12px;white-space:nowrap;vertical-align:middle">${od ? `<span style="color:#cc3a32;font-weight:600">seit ${od} ${od === 1 ? 'Tag' : 'Tagen'}</span>` : '<span style="color:#1d8a54;font-weight:600">heute</span>'}</td></tr>`;
      }).join('');
      body += `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e0e6ed;border-left:4px solid ${worst ? '#cc3a32' : '#1d8a54'};border-radius:10px;background:#ffffff">
<tr><td style="padding:12px 14px 4px;${F}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td style="${F};vertical-align:top"><div style="font-size:15px;font-weight:700;color:#0f1c27">${esc(vname(c.v))}${c.v.plate ? `<span style="display:inline-block;margin-left:8px;border:1.5px solid #0f1c27;border-radius:4px;padding:0 5px;font-size:11px;font-weight:700;vertical-align:2px">${esc(c.v.plate)}</span>` : ''}</div>
<div style="font-family:Consolas,Menlo,monospace;font-size:12px;color:#5b6878;margin-top:2px">${esc(c.v.fin)}</div></td>
<td align="right" style="vertical-align:top">${c.v.spot ? `<span style="display:inline-block;background:#0e1a24;color:#ffffff;border-radius:8px;padding:4px 9px;${F};font-size:12px;font-weight:700;white-space:nowrap">${esc(c.v.spot)}</span>` : ''}</td></tr></table>
</td></tr>
<tr><td style="padding:4px 14px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table></td></tr></table></td></tr>`;
    }
  }
  const logo = APP_URL.replace(/\/?$/, '/') + 'icon-192.png';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f5f8">
<div style="display:none;max-height:0;overflow:hidden">${n ? `${n} Maßnahmen bei ${cars} Fahrzeugen${late ? `, ${late} überfällig` : ''}` : 'Heute nichts zu tun'}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px">
<tr><td style="padding:0 4px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="44" style="vertical-align:middle"><img src="${esc(logo)}" width="40" height="40" alt="" style="display:block;border-radius:10px"></td>
<td style="padding-left:12px;${F};vertical-align:middle"><div style="font-size:18px;font-weight:700;color:#0f1c27">Fahrzeugpflege</div><div style="font-size:13px;color:#5b6878">${esc(wd)}</div></td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border-radius:16px;padding:24px 22px;border:1px solid #e0e6ed">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="${F};font-size:16px;color:#0f1c27;padding-bottom:6px">${esc(hello)}</td></tr>
<tr><td style="${F};font-size:15px;color:#33404c;line-height:1.5;padding-bottom:18px">${n ? `hier ist dein Überblick für heute${late ? ' – die rot markierten Fahrzeuge haben überfällige Maßnahmen' : ''}.` : 'heute steht keine Maßnahme an. Schönen Tag!'}</td></tr>
${n ? `<tr><td style="padding-bottom:6px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${tile(n - late, 'heute fällig', '#1d8a54', '#e2f4ea')}${tile(late, 'überfällig', late ? '#cc3a32' : '#5b6878', late ? '#fde7e4' : '#edf1f5')}${tile(cars, cars === 1 ? 'Fahrzeug' : 'Fahrzeuge', '#0c6fa4', '#e3f0f7')}</tr></table></td></tr>
${body}` : ''}
<tr><td align="center" style="padding:18px 0 4px"><a href="${esc(APP_URL)}" style="display:inline-block;background:#0c6fa4;color:#ffffff;text-decoration:none;${F};font-size:15px;font-weight:700;padding:13px 26px;border-radius:10px">Rundgang in der App öffnen</a></td></tr>
</table></td></tr>
<tr><td style="padding:16px 10px 0;${F};font-size:12px;line-height:1.5;color:#8592a0;text-align:center">${esc(off)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: person.email, subject, text, html, count: n };
}

/* Hauptprogramm */
async function main() {
  const now = viennaNow(), dry = process.env.DRY_RUN === '1';
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.log('FIREBASE_SERVICE_ACCOUNT ist nicht eingerichtet – nichts zu tun (siehe tools/reminder/README.md).'); return; }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(sa)) });
  const db = getFirestore(), ref = db.doc('settings/reminders');
  const rem = (await ref.get()).data() || {};
  const force = process.env.FORCE === '1', people = due(rem, now, force);
  if (force) console.log('Testlauf: E-Mail wird an alle Empfänger geschickt, auch wenn sie heute schon eine bekommen haben.');
  console.log(`Wien ${now.day} ${now.hour}:xx – fällige Empfänger: ${people.length}`);
  if (!people.length) { await ref.set({ run: { at: new Date().toISOString(), sent: 0 } }, { merge: true }); return; }

  const smtp = { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  const from = process.env.MAIL_FROM || (smtp.user ? `Fahrzeugpflege <${smtp.user}>` : '');
  const canSend = !dry && smtp.host && smtp.user && smtp.pass;
  if (!canSend) console.log(dry ? 'DRY_RUN: es wird nichts verschickt.' : 'SMTP ist nicht eingerichtet – es wird nichts verschickt.');

  const [cf, vs, ts] = await Promise.all([
    db.doc('settings/cfg').get(),
    db.collection('vehicles').get(),
    db.collection('tasks').where('status', 'in', ['Offen', 'In Bearbeitung']).get(),
  ]);
  const sites = ((cf.data() || {}).sites || []).filter(Boolean), vehicles = vs.docs.map(d => d.data()), tasks = ts.docs.map(d => d.data());
  if (!sites.length) sites.push('Mondsee');
  let transport = null;
  if (canSend) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } });
  }
  let sent = 0;
  for (const p of people) {
    const list = listFor(p, vehicles, tasks, now.day, sites), upd = {};
    if (!list.length && !p.empty) { upd[`r.${p.uid}.last`] = now.day; upd[`r.${p.uid}.lastN`] = 0; await ref.update(upd); console.log(`${p.email}: nichts fällig, keine E-Mail.`); continue; }
    const m = buildMail(p, list, now.day);
    if (!canSend) { console.log(`--- ${m.to}: ${m.subject}\n${m.text}`); continue; }
    try {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      sent++; upd[`r.${p.uid}.last`] = now.day; upd[`r.${p.uid}.lastN`] = m.count; upd[`r.${p.uid}.err`] = FieldValue.delete();
      console.log(`${m.to}: verschickt (${m.count}).`);
    } catch (e) {
      upd[`r.${p.uid}.err`] = String(e && e.message || e).slice(0, 200);
      console.error(`${m.to}: Fehler – ${upd[`r.${p.uid}.err`]}`);
    }
    await ref.update(upd);
  }
  await ref.set({ run: { at: new Date().toISOString(), sent } }, { merge: true });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
