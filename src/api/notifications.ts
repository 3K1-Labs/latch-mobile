import { unwrap } from '@/src/api/unwrap';
import { API_BASE_URL } from '@/src/constants/api-host';

const API_BASE = `${API_BASE_URL}/v1/notifications`;

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsPage {
  notifications: AppNotification[];
  next_cursor: string | null;
  unread_count: number;
}

export class NotificationsApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function xhr(
  method: string,
  url: string,
  body: string | null,
  token: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    req.timeout = 30000;
    req.onload = () => {
      let parsed: any = null;
      if (req.responseText) {
        try {
          parsed = JSON.parse(req.responseText);
        } catch {
          parsed = null;
        }
      }
      resolve({ status: req.status, body: parsed });
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(body);
  });
}

async function call<T>(method: string, path: string, token: string): Promise<T> {
  const { status, body } = await xhr(method, `${API_BASE}${path}`, null, token);
  if (status >= 200 && status < 300) return unwrap<T>(body);
  const err = body?.error;
  throw new NotificationsApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

export async function listNotifications(
  token: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<NotificationsPage> {
  const params: string[] = [];
  if (opts.cursor) params.push(`cursor=${encodeURIComponent(opts.cursor)}`);
  if (opts.limit) params.push(`limit=${opts.limit}`);
  const query = params.length ? `?${params.join('&')}` : '';
  const page = await call<Partial<NotificationsPage>>('GET', query, token);
  return {
    notifications: page.notifications ?? [],
    next_cursor: page.next_cursor ?? null,
    unread_count: page.unread_count ?? 0,
  };
}

export async function getUnreadCount(token: string): Promise<number> {
  const res = await call<{ unread_count?: number }>('GET', '/unread-count', token);
  return res.unread_count ?? 0;
}

export async function markRead(token: string, id: string): Promise<void> {
  await call<unknown>('POST', `/${encodeURIComponent(id)}/read`, token);
}

export async function markAllRead(token: string): Promise<void> {
  await call<unknown>('POST', '/read-all', token);
}
