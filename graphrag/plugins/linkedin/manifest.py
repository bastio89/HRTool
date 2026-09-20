from __future__ import annotations

from dataclasses import dataclass

from ..base import PluginManifest, PluginRoute


LINKEDIN_PLUGIN_ID = "linkedin"
LINKEDIN_PLUGIN_NAME = "LinkedIn"
LINKEDIN_PLUGIN_UI_SLOTS = ("sidebar", "tools", "routes")


def build_linkedin_manifest(enabled: bool) -> PluginManifest:
    return PluginManifest(
        id=LINKEDIN_PLUGIN_ID,
        name=LINKEDIN_PLUGIN_NAME,
        enabled=enabled,
        ui_slots=LINKEDIN_PLUGIN_UI_SLOTS,
        routes=(
            PluginRoute(path="/plugins/linkedin/profile", methods=("POST",)),
            PluginRoute(path="/plugins/linkedin/people-search.csv", methods=("POST",)),
            PluginRoute(path="/plugins/linkedin/export-pdf", methods=("POST",)),
        ),
    )
