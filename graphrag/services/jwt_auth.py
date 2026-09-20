from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any


def _base64url_decode(value: str) -> bytes:
	padding = '=' * (-len(value) % 4)
	return base64.urlsafe_b64decode((value + padding).encode('ascii'))


def _parse_jwt_parts(token: str) -> tuple[dict[str, Any], bytes, bytes]:
	parts = token.split('.')
	if len(parts) != 3:
		raise ValueError('Invalid JWT format')
	header = json.loads(_base64url_decode(parts[0]).decode('utf-8'))
	payload = json.loads(_base64url_decode(parts[1]).decode('utf-8'))
	signature = _base64url_decode(parts[2])
	return {**header, **{'payload': payload}}, parts[0].encode('ascii') + b'.' + parts[1].encode('ascii'), signature


def verify_hs256_jwt(token: str, secret: str) -> dict[str, Any]:
	clean_token = str(token or '').strip()
	clean_secret = str(secret or '').strip()
	if not clean_token:
		raise ValueError('Missing token')
	if not clean_secret:
		raise ValueError('Missing JWT secret')

	parsed, signing_input, signature = _parse_jwt_parts(clean_token)
	if str(parsed.get('alg') or '').upper() != 'HS256':
		raise ValueError('Unsupported JWT algorithm')

	expected = hmac.new(clean_secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
	if not hmac.compare_digest(expected, signature):
		raise ValueError('Invalid token signature')

	payload = parsed['payload']
	if not isinstance(payload, dict):
		raise ValueError('Invalid JWT payload')

	exp = payload.get('exp')
	if exp is not None:
		try:
			exp_value = float(exp)
		except (TypeError, ValueError) as exc:
			raise ValueError('Invalid token expiration') from exc
		if exp_value <= __import__('time').time():
			raise ValueError('Token expired')

	return payload
