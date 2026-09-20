from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from config import Settings
from services.postgres_store import PostgresStore

from .settings import PLUGIN_SETTING_KEY
from .service import BillingService


def _decimal_or_400(value: Any, field_name: str) -> Decimal:
	try:
		amount = Decimal(str(value).strip())
	except (InvalidOperation, AttributeError, TypeError, ValueError) as exc:
		raise HTTPException(status_code=400, detail=f'{field_name} muss eine Zahl sein') from exc
	if amount == 0:
		raise HTTPException(status_code=400, detail=f'{field_name} darf nicht 0 sein')
	return amount.quantize(Decimal('0.01'))


def build_billing_router(settings: Settings, *, postgres_store: PostgresStore) -> APIRouter:
	router = APIRouter(prefix='/credits', tags=['Credits'])
	billing_service = BillingService(postgres_store, jwt_secret=getattr(settings, 'jwt_secret', None))

	async def ensure_enabled() -> None:
		raw = await postgres_store.get_settings([PLUGIN_SETTING_KEY])
		if raw.get(PLUGIN_SETTING_KEY, '1').strip().lower() not in {'1', 'true', 'yes', 'on'}:
			raise HTTPException(status_code=404, detail='Billing plugin is disabled')

	@router.get('/')
	async def manifest() -> dict[str, object]:
		await ensure_enabled()
		return {
			'id': 'billing',
			'name': 'Billing',
			'enabled': True,
			'uiSlots': ['routes'],
			'routes': ['/credits/me', '/credits/admin/overview', '/credits/admin/users', '/credits/admin/top-up'],
		}

	@router.get('/me')
	async def me(request: Request) -> dict[str, Any]:
		await ensure_enabled()
		return await billing_service.get_current_summary(request)

	@router.get('/admin/overview')
	async def admin_overview(request: Request) -> dict[str, Any]:
		await ensure_enabled()
		return await billing_service.admin_overview(request)

	@router.get('/admin/users')
	async def admin_users(request: Request, search: str | None = Query(default=None)) -> dict[str, Any]:
		await ensure_enabled()
		users = await billing_service.admin_users(request, search=search)
		return {'data': users}

	@router.get('/admin/users/{user_id}/transactions')
	async def admin_transactions(request: Request, user_id: int) -> dict[str, Any]:
		await ensure_enabled()
		transactions = await billing_service.admin_transactions(request, user_id)
		return {'data': transactions}

	@router.post('/admin/top-up')
	async def admin_top_up(request: Request) -> dict[str, Any]:
		await ensure_enabled()
		payload = await request.json()
		user_id_raw = payload.get('userId') if isinstance(payload, dict) else None
		try:
			user_id = int(user_id_raw)
		except (TypeError, ValueError) as exc:
			raise HTTPException(status_code=400, detail='userId ist erforderlich') from exc
		amount = _decimal_or_400(payload.get('amount') if isinstance(payload, dict) else None, 'amount')
		reason = str(payload.get('reason') or '').strip() if isinstance(payload, dict) else ''
		admin_pin = str(payload.get('adminPin') or '').strip() if isinstance(payload, dict) else ''
		return await billing_service.admin_top_up(request, user_id=user_id, amount=amount, reason=reason, admin_pin=admin_pin)

	return router
