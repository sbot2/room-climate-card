"""Config flow for the Room Climate integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow

from .const import DEFAULT_TITLE, DOMAIN


class RoomClimateConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Room Climate."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step: create the entry directly."""
        return self.async_create_entry(title=DEFAULT_TITLE, data={})
