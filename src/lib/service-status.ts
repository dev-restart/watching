/** Public status contains only fixed codes, never upstream hosts, URLs or tokens. */
export interface ServiceStatus {
	state: 'available' | 'unavailable' | 'maintenance';
	reason: 'ok' | 'configuration' | 'connection' | 'upstream' | 'response' | 'maintenance';
	checkedAt: number;
	retryAfterMs: number;
}

export const STATUS_POLL_MS = 30_000;
export const STATUS_RECHECK_EVENT = 'watching:service-status-recheck';
export const STATUS_BLOCKED_EVENT = 'watching:service-status-blocked';

export const SERVICE_STATUS_MESSAGES = {
	checking: ['영상 서버 연결을 확인하고 있습니다', '서비스 이용 가능 여부를 확인한 뒤 검색과 재생을 시작합니다.'],
	unavailable: ['영상 서버에 연결할 수 없습니다', '외부 영상 서버의 응답이 없어 영상 정보를 불러올 수 없습니다. 연결이 복구되면 다시 이용할 수 있습니다.'],
	maintenance: ['현재 서버 점검 중입니다', '안정적인 서비스 제공을 위해 점검하고 있습니다. 점검이 끝나고 정상 연결이 확인되면 자동으로 이용할 수 있습니다.'],
	offline: ['인터넷 연결을 확인해 주세요', '현재 기기가 오프라인 상태입니다. 인터넷에 다시 연결되면 서비스 상태를 확인합니다.'],
	unknown: ['서비스 상태를 확인할 수 없습니다', '상태 확인 서버의 응답을 받지 못했습니다. 인터넷 연결 또는 일시적인 서버 문제일 수 있습니다.'],
	available: ['연결이 정상화되었습니다', '이제 서비스를 이용할 수 있습니다.']
} as const;

export function shouldOpenStatusDialog(previous: AvailabilityView['state'], next: AvailabilityView['state']): boolean {
	return next !== 'available' && next !== 'checking' && previous !== next;
}

export interface AvailabilityView {
	state: ServiceStatus['state'] | 'checking' | 'offline' | 'unknown';
	checking: boolean;
	checkedAt: number | null;
	retryAt: number | null;
}

export function initialAvailability(): AvailabilityView {
	return { state: 'checking', checking: false, checkedAt: null, retryAt: null };
}

export function parseServiceStatus(value: unknown): ServiceStatus {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid service status.');
	const data = value as Record<string, unknown>;
	if (typeof data.state !== 'string' || !['available', 'unavailable', 'maintenance'].includes(data.state) ||
		typeof data.reason !== 'string' || !['ok', 'configuration', 'connection', 'upstream', 'response', 'maintenance'].includes(data.reason) ||
		typeof data.checkedAt !== 'number' || !Number.isSafeInteger(data.checkedAt) || data.checkedAt < 0 ||
		typeof data.retryAfterMs !== 'number' || !Number.isFinite(data.retryAfterMs) ||
		data.retryAfterMs < 5_000 || data.retryAfterMs > 120_000 ||
		(data.state === 'available' && data.reason !== 'ok') ||
		(data.state === 'maintenance' && data.reason !== 'maintenance') ||
		(data.state === 'unavailable' && (data.reason === 'ok' || data.reason === 'maintenance'))) {
		throw new Error('Invalid service status.');
	}
	return { state: data.state as ServiceStatus['state'], reason: data.reason as ServiceStatus['reason'],
		checkedAt: data.checkedAt, retryAfterMs: data.retryAfterMs };
}

/** Only a validated response from our server gate can immediately block the current UI. */
export function reportServiceBlocked(path: string, httpStatus: number, value: unknown): void {
	if (httpStatus !== 503 || !['/api/search', '/api/episodes', '/api/session'].includes(path) ||
		!value || typeof value !== 'object' || !('code' in value) || value.code !== 'SERVICE_UNAVAILABLE' ||
		!('serviceStatus' in value)) return;
	try {
		const status = parseServiceStatus(value.serviceStatus);
		if (status.state !== 'available' && typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent(STATUS_BLOCKED_EVENT, { detail: status }));
		}
	} catch { /* A malformed failure still follows the normal real-probe path. */ }
}

/** API failures request a real probe; one missing episode never declares a global outage. */
export function requestServiceRecheck(path: string, status?: number): void {
	if (!['/api/search', '/api/episodes', '/api/session'].includes(path)) return;
	if (status !== undefined && status < 500) return;
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_RECHECK_EVENT));
}
