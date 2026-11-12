# Erinnerungs-E-Mails – einmalige Einrichtung

Die App selbst kann keine E-Mails zu einer bestimmten Uhrzeit verschicken (sie läuft nur, solange jemand sie geöffnet hat).
Das übernimmt ein kostenloser **GitHub-Actions-Zeitplan** in diesem Repository:
`.github/workflows/erinnerungen.yml` startet jede Stunde `tools/reminder/send.mjs`.

Das Skript schaut, wer in der App unter **Einstellungen → Erinnerungs-E-Mails** die E-Mails eingeschaltet hat,
ob dessen Uhrzeit erreicht ist und ob er heute schon eine bekommen hat. Höchstens **eine E-Mail pro Person und Tag**.
Solange die folgenden Geheimnisse (Secrets) fehlen, passiert **nichts**.

## 1. Firebase-Schlüssel (Dienstkonto)

1. [Firebase-Konsole](https://console.firebase.google.com/) → Projekt **tqs-fahrzeugpflege** → Zahnrad → **Projekteinstellungen** → **Dienstkonten**.
2. **Neuen privaten Schlüssel generieren** → es wird eine `.json`-Datei heruntergeladen.
3. ⚠️ Diese Datei gibt vollen Zugriff auf die Datenbank. Nicht weitergeben, nicht ins Repository hochladen. Nach Schritt 2 unten löschen.

## 2. Geheimnisse in GitHub hinterlegen

GitHub → Repository **TQS-Fahrzeugpflege** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Inhalt |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | den **kompletten Inhalt** der `.json`-Datei aus Schritt 1 |
| `SMTP_HOST` | Server des E-Mail-Postfachs, z. B. `smtp.gmail.com` |
| `SMTP_PORT` | meist `465` (oder `587`) |
| `SMTP_USER` | Absender-Adresse / Benutzername |
| `SMTP_PASS` | Passwort bzw. **App-Passwort** |
| `MAIL_FROM` | optional, z. B. `TQS Fahrzeugpflege <pflege@autohaus-reiser.at>` |

**Welches Postfach?**
- **Firmenpostfach** (z. B. Microsoft 365): SMTP-Daten bei der IT erfragen (`smtp.office365.com`, Port `587`). Bei Microsoft 365 muss „SMTP AUTH“ für das Postfach erlaubt sein.
- **Gmail**: eigenes Google-Konto mit Zwei-Faktor-Anmeldung → [App-Passwort erstellen](https://myaccount.google.com/apppasswords) → `smtp.gmail.com`, Port `465`.
- **Brevo** (kostenlos bis 300 E-Mails/Tag): SMTP-Zugang im Brevo-Konto anlegen.

## 3. Testen

GitHub → **Actions** → **Erinnerungs-E-Mails** → **Run workflow**.
- Mit Haken bei **„Nur testen“** wird nichts verschickt; der Inhalt steht im Protokoll des Laufs.
- Ohne Haken werden echte E-Mails an alle verschickt, deren Uhrzeit erreicht ist und die heute noch keine bekommen haben.

In der App erscheint unter **Einstellungen → Erinnerungs-E-Mails**, wann die letzte E-Mail verschickt wurde, oder eine Fehlermeldung.

## Gut zu wissen

- **Uhrzeit ist ungefähr:** GitHub startet geplante Läufe teils mit Verzögerung (bis ca. 1 Stunde).
- **Pause nach 60 Tagen:** Bei öffentlichen Repositorys schaltet GitHub geplante Abläufe ab, wenn 60 Tage lang nichts im Repository geändert wurde. Dann unter **Actions** wieder **Enable workflow** klicken.
- **Kosten:** keine. Pro Stunde wird 1 Dokument gelesen; nur wenn jemand dran ist, zusätzlich Fahrzeuge und offene Maßnahmen.
- Inhalt der E-Mail: alle Maßnahmen, die heute fällig sind (wahlweise inkl. überfälliger), sortiert nach Standort und Stellplatz.
