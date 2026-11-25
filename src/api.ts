export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    let message = `Request failed (${response.status}).`;
    try { message = (JSON.parse(body) as { error?: string }).error ?? message; }
    catch { message = `${message} ${body.slice(0, 160)}`; }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
