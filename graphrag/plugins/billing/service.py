from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, Request, status

from services.jwt_auth import verify_hs256_jwt
from services.postgres_store import InsufficientCreditsError, MatchingActorUnavailableError, PostgresStore


@dataclass(frozen=True)
class BillingUserClaims:
	user_id: int
	username: str | None
	display_name: str | None
	email: str | None
	role: str | None


class BillingService:
	def __init__(self, postgres_store: PostgresStore, *, jwt_secret: str | None = None, admin_pin: str | None = None) -> None:
		self.postgres_store = postgres_store
		self.jwt_secret = (jwt_secret or os.environ.get('JWT_SECRET') or '').strip()
		self.admin_pin = (admin_pin or os.environ.get('GRAPHRAG_ADMIN_CREDIT_PIN') or '').strip()
		self._pin_attempts: dict[str, list[float]] = defaultdict(list)
		self._pin_window_seconds = 15 * 60
		self._pin_max_attempts = 5

	def _client_key(self, request: Request) -> str:
		forwarded = request.headers.get('x-forwarded-for', '')
		if forwarded:
			first = forwarded.split(',')[0].strip()
			if first:
				return first
		client_host = getattr(request.client, 'host', None)
		return client_host or 'unknown'

	def _record_pin_failure(self, request: Request) -> None:
		key = self._client_key(request)
		now = time.time()
		self._pin_attempts[key] = [stamp for stamp in self._pin_attempts[key] if now - stamp < self._pin_window_seconds]
		self._pin_attempts[key].append(now)

	def _clear_pin_failures(self, request: Request) -> None:
		self._pin_attempts.pop(self._client_key(request), None)

	def _pin_rate_limited(self, request: Request) -> bool:
		key = self._client_key(request)
		now = time.time()
		self._pin_attempts[key] = [stamp for stamp in self._pin_attempts[key] if now - stamp < self._pin_window_seconds]
		return len(self._pin_attempts[key]) >= self._pin_max_attempts

	def _extract_bearer_token(self, request: Request) -> str:
		authorization = request.headers.get('authorization', '').strip()
		if not authorization.lower().startswith('bearer '):
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing bearer token')
		token = authorization.split(' ', 1)[1].strip()
		if not token:
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing bearer token')
		return token

	def _claims_from_request(self, request: Request) -> BillingUserClaims:
		try:
			claims = verify_hs256_jwt(self._extract_bearer_token(request), self.jwt_secret)
		except (ValueError, TypeError) as exc:
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

		user_id_raw = claims.get('id')
		try:
			user_id = int(user_id_raw)
		except (TypeError, ValueError) as exc:
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token user') from exc
		if isinstance(user_id_raw, bool) or not isinstance(user_id_raw, (int, str)) or user_id <= 0:
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token user')

		return BillingUserClaims(
			user_id=user_id,
			username=str(claims.get('username') or '').strip() or None,
			display_name=str(claims.get('display_name') or '').strip() or None,
			email=str(claims.get('email') or '').strip() or None,
			role=str(claims.get('role') or '').strip() or None,
		)

	async def _ensure_claims_user(self, request: Request) -> BillingUserClaims:
		claims = self._claims_from_request(request)
		await self.postgres_store.ensure_credit_user(
			claims.user_id,
			username=claims.username,
			email=claims.email,
			display_name=claims.display_name,
			role=claims.role,
		)
		return claims

	@staticmethod
	def _stored_claims(actor: dict[str, Any]) -> BillingUserClaims:
		return BillingUserClaims(
			user_id=int(actor['id']), username=actor['username'], display_name=actor['display_name'],
			email=actor['email'], role=actor['role'],
		)

	async def actor_for_request(self, request: Request) -> BillingUserClaims:
		claims = self._claims_from_request(request)
		actor = await self.postgres_store.get_matching_actor(claims.user_id)
		if actor is None:
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Matching user no longer exists')
		return self._stored_claims(actor)

	async def require_matching_admin(self, request: Request) -> BillingUserClaims:
		actor = await self.actor_for_request(request)
		if actor.role != 'admin':
			raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Nur Administratoren haben Zugriff auf Batchverarbeitung')
		return actor

	async def charge_matching_run(
		self, run_id: str, amount: Decimal | str | float, action_type: str, *, note: str | None = None,
	) -> dict[str, Any]:
		debit = Decimal(str(amount))
		if not debit.is_finite() or debit >= 0:
			raise ValueError('Matching debit must be a finite negative amount')
		run = await self.postgres_store.get_matching_run(run_id)
		if run is None:
			raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Matching run not found')
		actor_id = run['actor_user_id']
		if actor_id is None or await self.postgres_store.get_matching_actor(actor_id) is None:
			await self.postgres_store.block_matching_run(run_id, 'missing_actor')
			raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Matching actor no longer exists')
		try:
			return await self.postgres_store.apply_credit_transaction(
				actor_id, debit, action_type, matching_run_id=run_id,
				note=note, metadata={'matching_run_id': run_id},
			)
		except InsufficientCreditsError as exc:
			await self.postgres_store.block_matching_run(run_id, 'insufficient_credits')
			raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail='Insufficient credits') from exc
		except MatchingActorUnavailableError as exc:
			await self.postgres_store.block_matching_run(run_id, 'missing_actor')
			raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Matching actor no longer exists') from exc
		except ValueError as exc:
			raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

	async def get_current_summary(self, request: Request) -> dict[str, Any]:
		claims = await self._ensure_claims_user(request)
		return await self.postgres_store.get_credit_user_summary(claims.user_id)

	async def charge(self, request: Request, amount: Decimal | str | float, action_type: str, *, note: str | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
		claims = await self._ensure_claims_user(request)
		try:
			return await self.postgres_store.apply_credit_transaction(
				claims.user_id,
				amount,
				action_type,
				note=note,
				metadata=metadata,
				user_snapshot={
					'username': claims.username,
					'email': claims.email,
					'display_name': claims.display_name,
					'role': claims.role,
				},
			)
		except ValueError as exc:
			message = str(exc)
			status_code = status.HTTP_402_PAYMENT_REQUIRED if 'insufficient' in message.lower() else status.HTTP_400_BAD_REQUEST
			raise HTTPException(status_code=status_code, detail=message) from exc

	async def _require_admin(self, request: Request) -> BillingUserClaims:
		claims = await self._ensure_claims_user(request)
		if claims.role != 'admin':
			raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Nur Administratoren haben Zugriff auf die Kreditverwaltung')
		return claims

	def _verify_admin_pin(self, request: Request, provided_pin: str) -> None:
		if not self.admin_pin:
			raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='Admin PIN ist nicht konfiguriert')
		if self._pin_rate_limited(request):
			raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Zu viele falsche PIN-Versuche. Bitte später erneut versuchen.')
		if not hmac.compare_digest(self.admin_pin, str(provided_pin or '').strip()):
			self._record_pin_failure(request)
			raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Ungültiger Admin PIN')
		self._clear_pin_failures(request)

	async def admin_overview(self, request: Request) -> dict[str, Any]:
		await self._require_admin(request)
		return await self.postgres_store.get_credit_overview()

	async def admin_users(self, request: Request, search: str | None = None) -> list[dict[str, Any]]:
		await self._require_admin(request)
		return await self.postgres_store.list_credit_users(search=search)

	async def admin_transactions(self, request: Request, user_id: int) -> list[dict[str, Any]]:
		await self._require_admin(request)
		return await self.postgres_store.get_credit_transactions(user_id)

	async def admin_top_up(self, request: Request, *, user_id: int, amount: Decimal | str | float, reason: str | None, admin_pin: str) -> dict[str, Any]:
		await self._require_admin(request)
		self._verify_admin_pin(request, admin_pin)
		try:
			return await self.postgres_store.apply_credit_transaction(
				user_id,
				amount,
				'ADMIN_TOPUP',
				note=reason,
				metadata={'reason': reason or ''},
				allow_negative_balance=False,
			)
		except ValueError as exc:
			message = str(exc)
			status_code = status.HTTP_402_PAYMENT_REQUIRED if 'insufficient' in message.lower() else status.HTTP_400_BAD_REQUEST
			raise HTTPException(status_code=status_code, detail=message) from exc
