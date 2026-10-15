import { API_BASE_URL } from '@/src/constants/api-host';

const API_BASE = `${API_BASE_URL}/v1/devices`;

export class DevicesApiError extends Error {
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

async function call(method: string, path: string, body: object | null, token: string): Promise<void> {
  const { status, body: resp } = await xhr(
    method,
    `${API_BASE}${path}`,
    body ? JSON.stringify(body) : null,
    token,
  );
  if (status >= 200 && status < 300) return;
  const err = resp?.error;
  throw new DevicesApiError(
    err?.message ?? `Request failed (${status})`,
    err?.code ?? `HTTP_${status}`,
    status,
  );
}

export async function registerDevice(
  token: string,
  pushToken: string,
  platform?: string,
): Promise<void> {
  await call('POST', '', { push_token: pushToken, ...(platform ? { platform } : {}) }, token);
}

export async function deleteDevice(token: string, pushToken: string): Promise<void> {
  await call('DELETE', `/${encodeURIComponent(pushToken)}`, null, token);
}
