/* TQS Fahrzeugpflege – Erinnerungs-E-Mails
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
export function due(reminders, now) {
  const r = (reminders && reminders.r) || {};
  return Object.entries(r)
    .filter(([, p]) => p && p.on && MAILRE.test(p.email || '') && now.hour >= Number(p.hour ?? 6) && p.last !== now.day)
    .map(([uid, p]) => ({ uid, ...p }));
}

/* Liste der Maßnahmen für eine Person (gleiche Regeln wie in der App: aktive Fahrzeuge, nicht erledigt, nicht gelöscht) */
export function listFor(person, vehicles, tasks, today) {
  const vm = new Map(vehicles.filter(v => !v.archived).map(v => [v.fin, v]));
  const overdue = person.overdue !== false;
  return tasks
    .filter(t => vm.has(t.fin) && t.status !== 'Erledigt' && !t.removed && (t.due === today || (overdue && t.due < today)))
    .map(t => ({ t, v: vm.get(t.fin) }))
    .sort((a, b) => NAT.compare(a.v.loc || '~', b.v.loc || '~') || NAT.compare(a.v.spot || '~', b.v.spot || '~') || NAT.compare(a.v.fin, b.v.fin) || (a.t.due < b.t.due ? -1 : 1));
}

export function buildMail(person, list, today) {
  const late = list.filter(x => x.t.due < today).length, n = list.length;
  const subject = n
    ? `TQS Fahrzeugpflege: ${n} ${n === 1 ? 'Maßnahme' : 'Maßnahmen'} am ${fmt(today)}${late ? ` (davon ${late} überfällig)` : ''}`
    : `TQS Fahrzeugpflege: heute (${fmt(today)}) nichts zu tun`;
  const hello = `Servus ${person.name || ''}`.trim() + ',';
  const off = 'Du bekommst diese E-Mail, weil du in der App unter Einstellungen → Erinnerungs-E-Mails die Erinnerung eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.';
  /* Text-Version */
  let text = `${hello}\n\n${n ? `heute ${n === 1 ? 'ist 1 Maßnahme' : `sind ${n} Maßnahmen`} fällig${late ? `, davon ${late} überfällig` : ''}:` : 'heute steht keine Maßnahme an.'}\n`;
  let lastLoc = null;
  for (const { t, v } of list) {
    const loc = v.loc || 'Ohne Standort';
    if (loc !== lastLoc) { text += `\n${loc}\n`; lastLoc = loc; }
    text += `- ${v.spot ? `[${v.spot}] ` : ''}${vname(v)} (${v.fin}): ${t.title}${t.due < today ? ` – überfällig seit ${days(t.due, today)} ${days(t.due, today) === 1 ? 'Tag' : 'Tagen'}` : ''}\n`;
  }
  text += `\nApp öffnen: ${APP_URL}\n\n${off}\n`;
  /* HTML-Version */
  let rows = ''; lastLoc = null;
  for (const { t, v } of list) {
    const loc = v.loc || 'Ohne Standort';
    if (loc !== lastLoc) { rows += `<tr><td colspan="4" style="padding:14px 10px 6px;font-weight:700;font-size:15px;color:#132029;border-bottom:2px solid #f0a92e">📍 ${esc(loc)}</td></tr>`; lastLoc = loc; }
    const od = t.due < today ? days(t.due, today) : 0;
    rows += `<tr>
<td style="padding:9px 10px;border-bottom:1px solid #e3e8ee;font-family:Consolas,monospace;font-size:13px;white-space:nowrap;vertical-align:top">${esc(v.spot) || '–'}</td>
<td style="padding:9px 10px;border-bottom:1px solid #e3e8ee;vertical-align:top"><b>${esc(vname(v))}</b><br><span style="font-family:Consolas,monospace;font-size:12px;color:#5b6877">${esc(v.fin)}</span></td>
<td style="padding:9px 10px;border-bottom:1px solid #e3e8ee;vertical-align:top">${esc(t.title)}</td>
<td style="padding:9px 10px;border-bottom:1px solid #e3e8ee;vertical-align:top;white-space:nowrap">${od ? `<span style="background:#fde3e1;color:#b42318;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600">seit ${od} ${od === 1 ? 'Tag' : 'Tagen'}</span>` : '<span style="color:#1b8a4c;font-weight:600">heute</span>'}</td></tr>`;
  }
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#eef2f7;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#14202b">
<div style="max-width:680px;margin:0 auto;padding:20px 12px">
<div style="background:#132029;color:#fff;border-radius:12px 12px 0 0;padding:16px 20px;font-size:18px;font-weight:700">TQS Fahrzeugpflege <span style="font-weight:400;opacity:.75;font-size:14px">· ${fmt(today)}</span></div>
<div style="background:#fff;border-radius:0 0 12px 12px;padding:20px">
<p style="margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 16px">${n ? `heute ${n === 1 ? 'ist <b>1 Maßnahme</b>' : `sind <b>${n} Maßnahmen</b>`} fällig${late ? `, davon <b style="color:#b42318">${late} überfällig</b>` : ''} – sortiert nach Standort und Stellplatz:` : 'heute steht keine Maßnahme an. 🎉'}</p>
${n ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">
<tr><th align="left" style="padding:6px 10px;font-size:11px;color:#5b6877;text-transform:uppercase">Stellplatz</th><th align="left" style="padding:6px 10px;font-size:11px;color:#5b6877;text-transform:uppercase">Fahrzeug</th><th align="left" style="padding:6px 10px;font-size:11px;color:#5b6877;text-transform:uppercase">Maßnahme</th><th align="left" style="padding:6px 10px;font-size:11px;color:#5b6877;text-transform:uppercase">Fällig</th></tr>
${rows}</table>` : ''}
<p style="margin:22px 0 4px"><a href="${esc(APP_URL)}" style="display:inline-block;background:#f0a92e;color:#132029;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px">App öffnen</a></p>
</div>
<p style="font-size:12px;color:#5b6877;margin:14px 6px;line-height:1.5">${esc(off)}</p>
</div></body></html>`;
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
  const people = due(rem, now);
  console.log(`Wien ${now.day} ${now.hour}:xx – fällige Empfänger: ${people.length}`);
  if (!people.length) { await ref.set({ run: { at: new Date().toISOString(), sent: 0 } }, { merge: true }); return; }

  const smtp = { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  const from = process.env.MAIL_FROM || (smtp.user ? `TQS Fahrzeugpflege <${smtp.user}>` : '');
  const canSend = !dry && smtp.host && smtp.user && smtp.pass;
  if (!canSend) console.log(dry ? 'DRY_RUN: es wird nichts verschickt.' : 'SMTP ist nicht eingerichtet – es wird nichts verschickt.');

  const [vs, ts] = await Promise.all([
    db.collection('vehicles').get(),
    db.collection('tasks').where('status', 'in', ['Offen', 'In Bearbeitung']).get(),
  ]);
  const vehicles = vs.docs.map(d => d.data()), tasks = ts.docs.map(d => d.data());
  let transport = null;
  if (canSend) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } });
  }
  let sent = 0;
  for (const p of people) {
    const list = listFor(p, vehicles, tasks, now.day), upd = {};
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
