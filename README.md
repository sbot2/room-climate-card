# Room Climate Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)

Eine dynamische Raumklima-Karte für Home Assistant. Sie erkennt automatisch Räume, Etagen sowie Temperatur- und Luftfeuchtigkeitssensoren über die Geräte-/Entitätsregister. Kein Jinja, keine Auto-Entities und keine manuell gepflegten Entitätslisten erforderlich.

## Eigenschaften

- **Automatische Erkennung** von Bereichen (Areas), Etagen (Floors) sowie Temperatur- und Luftfeuchtigkeitssensoren über das Entity-/Device-Registry.
- **Etagen-Ansicht**: Räume werden nach Etage gruppiert und sortiert dargestellt.
- **Detailansicht pro Raum** mit Durchschnittswerten und Verlaufsdiagramm (12/24 Stunden).
- **Klimasteuerung** (optional): Steuerung beliebiger `climate.*`-Geräte (z. B. TRV oder Better Thermostat) direkt aus der Karte –
  - **Temperatur-Dial** (Dreh-/Klickregler wie HA bzw. Better Thermostat),
  - **HVAC-Modus als Dropdown** (z. B. off/heat/auto) mit Anzeige des aktuellen Zustands,
  - **Presets** aus dem Gerät (`preset_modes`), bei Geräten ohne Presets ausgegraut.
- **Visueller Editor**: Die Karte kann im Dashboard sowohl per YAML als auch über die GUI konfiguriert werden.
- **Live-Update**: Reagiert automatisch auf Änderungen im Bereichs-, Etagen-, Entitäts- und Geräte-Registry.

## Installation

### HACS (empfohlen)

1. Öffne HACS → **Frontend**.
2. Klicke auf **„Benutzerdefiniertes Repository hinzufügen“** (`⋮` → Custom repositories).
3. Füge die folgende URL ein:
   ```
   https://github.com/sbot2/room-climate-card
   ```
4. Wähle als Kategorie **Lovelace**.
5. Lade Home Assistant neu (ggf. `Strg+Shift+R` im Browser).

### Manuell

1. Lade `room-climate-card.js` herunter und lege sie in dein `www/`-Verzeichnis (`config/www/`).
2. Füge in deine Lovelace-Ressourcen folgende Zeile ein (URL entsprechend anpassen, `/local/` für `www/`):
   ```yaml
   resources:
     - url: /local/room-climate-card.js
       type: module
   ```
3. Lade die Seite neu.

## Verwendung

Füge folgenden Code zu deinem Dashboard hinzu (`Bearbeiten` → `Karte hinzufügen` → `Nach Typ suchen` → `room-climate-card`):

```yaml
type: custom:room-climate-card
title: Temperaturen/Luftfeuchtigkeit
columns: 2
exclude_areas:
  - fussboden
  - fußboden
```

| Option          | Typ     | Standard        | Beschreibung                                             |
| --------------- | ------- | --------------- | -------------------------------------------------------- |
| `title`         | string  | `Temperaturen/Luftfeuchtigkeit` | Titel der Karte.                           |
| `columns`       | number  | `2`             | Anzahl der Raum-Spalten pro Etage (1–4).                 |
| `exclude_areas` | list    | `["fussboden", "fußboden"]` | Bereiche, die nicht angezeigt werden (per **Bereichsname** oder **Area-ID**). |

> **Hinweis:** `exclude_areas` prüft ausschließlich **Area-Namen/-IDs**. Möchtest du eine gesamte **Etage** ausschließen, blende den jeweiligen Bereich bzw. dessen Areas entsprechend aus.

## Funktionsweise / Voraussetzungen

- Die Karte nutzt die WebSocket-APIs (`config/area_registry/list`, `config/floor_registry/list`, `config/entity_registry/list`, `config/device_registry/list`) sowie die Verlaufs-API.
- Sensoren werden über ihre `device_class` (`temperature` / `humidity`) erkannt. Sie müssen einem Bereich (Area) zugeordnet sein (direkt oder über ihr Gerät bzw. das übergeordnete Gerät).
- Klimageräte werden über die Domain `climate.` erkannt. Wenn sie einem Bereich zugeordnet sind (direkt oder über ihr Gerät), erscheinen sie in der Detailansicht des Raumes mit Temperatur-Dial, HVAC-Dropdown und (sofern vorhanden) Presets.
- Für den **visuellen Editor** genügt die normale Dashboard-Integration; die Karte stellt automatisch ein Konfigurationsformular bereit.

## Lizenz

[MIT](LICENSE)
