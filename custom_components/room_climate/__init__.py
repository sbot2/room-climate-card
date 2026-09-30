"""Room Climate integration.

Automatically creates per-area average temperature and humidity sensors
from the temperature/humidity sensors discovered via the entity registry.
"""

from __future__ import annotations

import asyncio
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry,
    device_registry,
    entity_registry,
)

from .const import DATA_ROOM_CLIMATE, DOMAIN
from .sensor import SENSOR_CLASSES, RoomClimateAverageSensor

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]

# Device classes that map to a sensor type we aggregate
# (kept in sync with SENSOR_CLASSES)

TEMP_CLASSES = {"temperature"}
HUMIDITY_CLASSES = {"humidity"}


async def async_setup(hass: HomeAssistant, config: dict):
    """Set up the integration from configuration.yaml (optional)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Room Climate from a config entry."""
    data = RoomClimateCoordinator(hass, entry)
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = data
    hass.data.setdefault(DATA_ROOM_CLIMATE, data)

    await data.async_setup()

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    data: RoomClimateCoordinator = hass.data[DOMAIN].get(entry.entry_id)
    if data:
        await data.async_unload()
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True


class RoomClimateCoordinator:
    """Holds discovered areas and creates average sensors."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.hass = hass
        self.entry = entry
        self._sensors: dict[str, RoomClimateAverageSensor] = {}
        self._published: set[str] = set()
        self._platform_add: callable | None = None
        self._unsubs: list = []
        self._task = None

    def register_platform(self, async_add_entities) -> None:
        """Register the platform add-entities callback (for later additions)."""
        self._platform_add = async_add_entities

    async def async_setup(self) -> None:
        """Register platform setup and initial discovery."""
        await self.hass.config_entries.async_forward_entry_setups(
            self.entry, PLATFORMS
        )
        # Rescan after HA is fully started (once). This listener must not be
        # unsubscribed manually, because it auto-removes itself after firing.
        self.hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, self._initial_scan
        )

    async def _initial_scan(self, _event=None) -> None:
        """Perform the initial registry scan and publish new sensors."""
        sensors = await self.async_refresh()
        self._publish(pending=sensors)

    async def async_unload(self) -> None:
        """Clean up on unload."""
        if self._task:
            self._task.cancel()
        await self.hass.config_entries.async_unload_platforms(self.entry, PLATFORMS)

    async def async_refresh(self) -> None:
        """Recompute which average sensors should exist."""
        er = entity_registry.async_get(self.hass)
        ar = area_registry.async_get(self.hass)
        dr = device_registry.async_get(self.hass)

        areas = {a.id: a for a in ar.async_list_areas()}
        entity_areas: dict[str, str | None] = {}

        for entity in er.entities.values():
            if entity.disabled_by or entity.hidden_by:
                continue
            if not entity.entity_id.startswith("sensor."):
                continue
            if entity.entity_id not in self.hass.states.async_entity_ids():
                continue
            dev_class = None
            state = self.hass.states.get(entity.entity_id)
            if state and state.attributes:
                dev_class = state.attributes.get("device_class")
            if dev_class not in SENSOR_CLASSES:
                continue

            area_id = entity.area_id
            if not area_id and entity.device_id:
                device = dr.async_get(entity.device_id)
                if device:
                    area_id = device.area_id
                    if not area_id:
                        parent = device
                        seen = set()
                        while parent and not area_id and parent.id not in seen:
                            seen.add(parent.id)
                            parent = dr.async_get(parent.parent_device_id)
                            if parent and parent.area_id:
                                area_id = parent.area_id
            if not area_id:
                continue

            entity_areas[entity.entity_id] = area_id

        area_sensor_map: dict[str, dict[str, list[str]]] = {}
        for entity_id, area_id in entity_areas.items():
            state = self.hass.states.get(entity_id)
            dev_class = ""
            if state and state.attributes:
                dev_class = state.attributes.get("device_class")
            slot = area_sensor_map.setdefault(
                area_id, {"temperature": [], "humidity": []}
            )
            if dev_class in slot:
                slot[dev_class].append(entity_id)

        wanted: dict[str, RoomClimateAverageSensor] = {}
        for area_id, classes in area_sensor_map.items():
            area = areas.get(area_id)
            if not area:
                continue
            area_name = area.name or area_id
            for dev_class in SENSOR_CLASSES:
                ids = classes.get(dev_class, [])
                if not ids:
                    continue
                key = self._key(area_id, dev_class)
                sensor = self._sensors.get(key)
                if sensor is None:
                    sensor = RoomClimateAverageSensor(
                        self.hass, area_id, area_name, dev_class, ids
                    )
                    self._sensors[key] = sensor
                else:
                    sensor._source_ids = list(ids)
                    sensor._update_sources()
                wanted[key] = sensor

        for key in list(self._sensors):
            if key not in wanted:
                self._sensors.pop(key)

        return list(wanted.values())

    def _key(self, area_id: str, dev_class: str) -> str:
        return f"{area_id}_{dev_class}"

    def _publish(self, pending=None) -> None:
        """Deliver newly-created sensors to the registered platform."""
        if self._platform_add is None:
            return
        if pending is None:
            pending = [
                sensor
                for key, sensor in self._sensors.items()
                if key not in self._published
            ]
        pending = [
            s
            for s in pending
            if self._key(s._area_id, s._device_class) not in self._published
        ]
        if not pending:
            return
        for sensor in pending:
            self._published.add(
                self._key(sensor._area_id, sensor._device_class)
            )
        self._platform_add(pending)
