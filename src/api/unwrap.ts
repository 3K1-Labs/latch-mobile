export function unwrap<T>(body: any): T {
  return (body?.data ?? body) as T;
}
