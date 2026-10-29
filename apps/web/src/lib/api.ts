const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
let session: Promise<unknown> | undefined;
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.error?.code || 'REQUEST_FAILED',
      data.error?.message || 'The request could not be completed. Please try again.',
      response.status,
    );
  return data as T;
}
export function ensureSession() {
  session ??= request('/sessions/guest', { method: 'POST' }).catch((error: unknown) => {
    session = undefined;
    throw error;
  });
  return session;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  await ensureSession();
  return request<T>(path, options);
}
export function mutation<T>(path: string, body: unknown = {}, key = crypto.randomUUID()) {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}
export function displayTime(value: string, timezone?: string) {
  try {
    return new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}
export function displayDate(value: string) {
  try {
    return new Intl.DateTimeFormat('en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
