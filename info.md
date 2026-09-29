## Room Climate Card

Eine dynamische Raumklima-Karte für Home Assistant. Erkennt automatisch Räume, Etagen sowie Temperatur- und Luftfeuchtigkeitssensoren über die Geräte-/Entitätsregister – ganz ohne Jinja, Auto-Entities oder manuell gepflegte Listen.

### Highlights

- Automatische Erkennung über Area-, Floor-, Entity- und Device-Registry
- Gruppierung nach Etagen, inkl. Sortierung (nach Etagen-Level)
- Detailansicht pro Raum mit Verlaufsdiagramm (12/24 Stunden) und Durchschnittswerten
- Optionale Klimasteuerung (HVAC-Modi + Temperatur)
- Live-Updates bei Registry-Änderungen

### Installation

Über HACS (Lovelace / Benutzerdefiniertes Repository) oder manuell als Modul-Ressource. Details siehe [README.md](README.md).

### Konfiguration

```yaml
type: custom:room-climate-card
title: Temperaturen/Luftfeuchtigkeit
columns: 2
exclude_areas:
  - fussboden
  - fußboden
```
