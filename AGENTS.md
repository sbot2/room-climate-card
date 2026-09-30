# AGENTS.md

Arbeitsanweisungen und Projekt-Kontext für dieses Repository. Wird von Coding-Agents beim Arbeiten im Projekt automatisch eingelesen.

## Projekt

**Room Climate Card** – eine dynamische Lovelace-Karte für Home Assistant. Eine einzelne Datei `room-climate-card.js` (kein Build-Schritt, kein npm) plus optionales Backend.

Teile:
- **Karte** (`room-climate-card.js`): erkennt automatisch Bereiche (Areas), Etagen (Floors), Temperatur-/Luftfeuchtigkeitssensoren und `climate.*`-Geräte über das Area-/Floor-/Entity-/Device-Registry,
  - gruppiert Räume nach Etage, bietet eine Detailansicht pro Raum (Durchschnittswerte, Verlaufsdiagramm),
  - enthält eine Klimasteuerung in der Detailansicht (Temperatur-Dial, HVAC-Dropdown, Presets).
- **Backend-Integration** (`custom_components/room_climate/`): erzeugt automatisch echte HA-Durchschnittssensoren (Temperatur/Luftfeuchtigkeit) pro Bereich aus dem Entity-/Area-Registry. Die Karte erkennt diese über das `area_id`-Attribut und nutzt ihre Werte automatisch; ohne die Integration fällt sie auf die eigene Berechnung zurück.

Hinweis: HACS installiert Karte (Frontend/Dashboard) und Integration (Integration) aus demselben Repo als **zwei** Installationen.

## Wichtige Regeln (bitte einhalten)

### 1. README immer synchron halten
Bei **jeder** Änderung, die das Nutzerverhalten betrifft (neue Features, geänderte/neue Konfigurationsoptionen, Umbenennungen, Editor-Updates), muss die **`README.md`** entsprechend aktualisiert und zusammen mit dem Code committet werden.

### 2. Keine Lit-Bindings in `innerHTML`
Die Karte und ihr Editor sind **native Custom Elements (KEIN LitElement)**. Lit-spezifische Bindings wie `@click="${...}"` oder `.prop="${...}"` funktionieren **nicht** in `innerHTML`-Zuweisungen – sie erscheinen als roher Text/Codetext. Event-Handler und Properties müssen über `querySelector(...)` + `addEventListener(...)` bzw. direkte Property-Zuweisung per DOM verbunden werden.

### 3. Editor-Element
- Registriert als `room-climate-card-editor`.
- Die Kartenklasse stellt `static getConfigElement()` und `static getStubConfig()` bereit (HA ruft diese **statisch** auf, nicht als Instanzmethoden).
- `window.customEditors.push({ type: "room-climate-card", name: "...", element: "room-climate-card-editor" })` ist vorhanden.
- Der Editor verwendet native `<input>`/`<button>`-Elemente (kein `ha-form`/`ha-textfield`, die sich als unzuverlässig erwiesen haben).
- Das Formular wird beim `setConfig` nur **einmal** aufgebaut (Check auf `#title`), danach synchronisiert `_syncFields()` die Werte, ohne den Fokus zu verlieren (`document.activeElement`-Prüfung). Nicht zurück auf „jedes Mal neu rendern" ändern.

### 4. Konfigurations-Defaults
In `setConfig` der Hauptkarte werden Defaults **nur ergänzt, wenn der Schlüssel fehlt** (bzw. `exclude_areas === undefined`). Defaults dürfen vorhandene Nutzerwerte nie überschreiben. `exclude_areas` kann als String (kommagetrennt) oder Array vorliegen und wird normalisiert.

### 5. `exclude_areas` Semantik
`exclude_areas` vergleicht ausschließlich **Area-Name** und **Area-ID** (case-insensitive), **nicht** Etagen. Keine Floor-Erweiterung hinzufügen, ohne die README zu aktualisieren.

### 6. Leere Räume
Räume (Bereiche) ohne **einen einzigen** Temperatur-/Feuchte-Wert **und** ohne Klima-Gerät werden gefiltert und nicht angezeigt (Filter in `_roomData()`).

### 7. Klimasteuerung
- für **alle** `climate.*`-Geräte im Raum,
- Temperatur per **SVG-Dial** (Klick/Drag), HVAC-Modus per **Dropdown**, Presets aus `preset_modes` (bei fehlenden Presets ausgegraut/anzeigen als „Keine Presets verfügbar"),
- Service-Aufrufe: `climate.set_temperature`, `climate.set_hvac_mode`, `climate.set_preset_mode`.

## HACS / Repo

- HACS-Custom-Repository (Installation): `https://github.com/sbot2/room-climate-card`
- Selbst gehostetes Forgejo (Entwicklung/Origin): `https://git.stebot76.noip.me/stephan/room-climate-card`
- `hacs.json` mit `subdirectory: custom_components/room_climate`.
- Kategorie im HACS-Store: **Integration** (das Repo wird primär als Integration installiert; die Karte wird aus demselben Repo als Frontend-Ressource eingebunden).
- Keine CI/Workflows mehr (`.github` wurde entfernt – das Repo liegt auf einem selbst gehosteten Forgejo, HACS-Validierung wäre dort nicht nutzbar).
- Git-Push kann gelegentlich mit `Credentials are incorrect` fehlschlagen. Bei **jedem** fehlgeschlagenen `git push` immer **zuerst automatisch einen zweiten Versuch** ausführen. Erst wenn auch der zweite Versuch scheitert, den Nutzer um manuelles Eingreifen bitten.

## Verifikation

Nach Code-Änderungen Syntax prüfen mit:
```
node --check room-climate-card.js
```
