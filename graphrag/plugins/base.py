from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Sequence

from fastapi import APIRouter, FastAPI


@dataclass(frozen=True)
class PluginRoute:
    path: str
    methods: tuple[str, ...] = ("GET",)


@dataclass(frozen=True)
class PluginManifest:
    id: str
    name: str
    enabled: bool
    ui_slots: tuple[str, ...] = ()
    routes: tuple[PluginRoute, ...] = ()


class BasePlugin(ABC):
    @property
    @abstractmethod
    def manifest(self) -> PluginManifest:
        raise NotImplementedError

    @abstractmethod
    def is_enabled(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def register(self, app: FastAPI) -> None:
        raise NotImplementedError
