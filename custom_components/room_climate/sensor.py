"""Sensors for the Room Climate aggregates integration."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_platform
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.template import Template

from .const import DATA_ROOM_CLIMATE, DOMAIN

# Sensor classes selected for aggregation: temperature and humidity
SENSOR_CLASSES = ("temperature", "humidity")


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities
) -> None:
    """Set up the sensor platform from a config entry."""
    coordinator = hass.data.get(DATA_ROOM_CLIMATE)
    if coordinator is None:
        return
    coordinator.register_platform(async_add_entities)


class RoomClimateAverageSensor(SensorEntity):
    """Average of a set of source sensors for one area."""

    _attr_should_poll = False
    _attr_has_entity_name = False

    def __init__(
        self,
        hass: HomeAssistant,
        area_id: str,
        area_name: str,
        device_class: str,
        source_ids: list[str],
    ) -> None:
        """Initialize the average sensor."""
        self.hass = hass
        self._area_id = area_id
        self._area_name = area_name
        self._device_class = device_class
        self._source_ids = list(source_ids)

        self._attr_device_class = device_class
        if device_class == "temperature":
            self._attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
        else:
            self._attr_native_unit_of_measurement = PERCENTAGE

        self._attr_unique_id = (
            f"{DOMAIN}_{area_id}_{device_class}_average"
        )
        self._attr_name = f"{area_name} Durchschnitt {self._type_label()}"

        self._child_updates: set = set()
        self._update_sources()

    def _type_label(self) -> str:
        if self._device_class == "temperature":
            return "Temperatur"
        return "Luftfeuchtigkeit"

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the unit of measurement."""
        return self._attr_native_unit_of_measurement

    @property
    def device_class(self) -> SensorDeviceClass | None:
        """Return the device class of the sensor."""
        return self._attr_device_class

    @property
    def state_class(self) -> str | None:
        """Return the state class of the sensor."""
        return "measurement"

    @property
    def extra_state_attributes(self) -> dict:
        """Expose attributes so clients (e.g. the card) can map this sensor to an area."""
        return {
            "area_id": self._area_id,
            "area_name": self._area_name,
            "source_sensors": self._source_ids,
        }

    def _update_sources(self) -> None:
        """Register callbacks for all source sensors."""
        for entity_id in self._source_ids:
            if entity_id in self._child_updates:
                continue
            self._child_updates.add(entity_id)
            self.hass.helpers.event.async_track_state_change_event(
                entity_id, self._state_changed
            )

    @callback
    def _state_changed(self, event) -> None:
        """Recompute the average when a source changes."""
        self.async_schedule_update_ha_state(True)

    def _current_value(self, entity_id: str) -> float | None:
        """Get the numeric value of a source entity."""
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        try:
            value = float(state.state)
        except (ValueError, TypeError):
            return None
        if state.state in ("unknown", "unavailable", "None"):
            return None
        return value

    def _numeric_average(self, values) -> float | None:
        """Average a list of finite numbers."""
        valid = [v for v in values if v is not None]
        if not valid:
            return None
        return sum(valid) / len(valid)

    @property
    def native_value(self) -> float | None:
        """Return the current average value."""
        values = [self._current_value(e) for e in self._source_ids]
        return self._numeric_average(values)
