# Room Climate Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)

Eine dynamische Raumklima-Karte für Home Assistant. Sie erkennt automatisch Räume, Etagen sowie Temperatur- und Luftfeuchtigkeitssensoren über die Geräte-/Entitätsregister. Kein Jinja, keine Auto-Entities und keine manuell gepflegten Entitätslisten erforderlich.

## Eigenschaften

- **Automatische Erkennung** von Bereichen (Areas), Etagen (Floors) sowie Temperatur- und Luftfeuchtigkeitssensoren über das Entity-/Device-Registry.
- **Etagen-Ansicht**: Räume werden nach Etage gruppiert und sortiert dargestellt.
- **Detailansicht pro Raum** mit Durchschnittswerten und Verlaufsdiagramm (12/24 Stunden).
- **Klimasteuerung** (optional): Steuerung von TRV-/Klimageräten direkt aus der Karte (Modi + Temperatur).
- **Live-Update**: Reagiert automatisch auf Änderungen im Bereichs-, Etagen-, Entitäts- und Geräte-Registry.

## Installation

### HACS (empfohlen)

1. Öffne HACS → **Frontend**.
2. Klicke auf **„Benutzerdefiniertes Repository hinzufügen“** (`⋮` → Custom repositories).
3. Füge die URL deines Forgejo/Git-Repository ein. Beispiel:
   ```
   https://git.example.com/<benutzer>/room-climate
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
| `exclude_areas` | list    | `["fussboden", "fußboden"]` | Bereiche, die nicht angezeigt werden (Name oder Area-ID). |

## Funktionsweise / Voraussetzungen

- Die Karte nutzt die WebSocket-APIs (`config/area_registry/list`, `config/floor_registry/list`, `config/entity_registry/list`, `config/device_registry/list`) sowie die Verlaufs-API.
- Sensoren werden über ihre `device_class` (`temperature` / `humidity`) erkannt. Sie müssen einem Bereich (Area) zugeordnet sein (direkt oder über ihr Gerät bzw. das übergeordnete Gerät).
- Klimageräte werden über die Domain `climate.` erkannt und können, wenn sie einem Bereich zugeordnet sind, gesteuert werden.

## Lizenz

[MIT](LICENSE)
