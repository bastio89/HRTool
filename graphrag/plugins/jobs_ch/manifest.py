from __future__ import annotations

from ..base import PluginManifest, PluginRoute


JOBS_CH_PLUGIN_ID = "jobs_ch"
JOBS_CH_PLUGIN_NAME = "Jobs.ch"
JOBS_CH_PLUGIN_UI_SLOTS = ("sidebar", "tools", "routes")


def build_jobs_ch_manifest(enabled: bool) -> PluginManifest:
    return PluginManifest(
        id=JOBS_CH_PLUGIN_ID,
        name=JOBS_CH_PLUGIN_NAME,
        enabled=enabled,
        ui_slots=JOBS_CH_PLUGIN_UI_SLOTS,
        routes=(
            PluginRoute(path="/tools/jobs-ch", methods=("GET",)),
            PluginRoute(path="/plugins/jobs_ch/export-pdf", methods=("POST",)),
            PluginRoute(path="/plugins/jobs_ch/import-db", methods=("POST",)),
        ),
    )
