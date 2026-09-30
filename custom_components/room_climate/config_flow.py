"""Config flow for the Room Climate integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow
from homeassistant.const import CONF_NAME

from .const import DEFAULT_TITLE, DOMAIN


class RoomClimateConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Room Climate."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if user_input is not None:
            return self.async_create_entry(title=user_input[CONF_NAME], data={})

        return self.async_show_form(
            step_id="user",
            data_schema=None,
            errors=None,
        )

    async def async_step_import(self, user_input=None):
        """Import a config entry."""
        return self.async_create_entry(title=DEFAULT_TITLE, data={})
