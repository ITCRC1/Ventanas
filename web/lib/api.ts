// Cliente HTTP. Todas las llamadas van a /api/* (Next reenvía al FastAPI) con la
// cookie de sesión. Los errores llegan en formato problem+json (RFC 7807).

export interface ProblemError {
  status: number;
  title: string;
  detail?: string;
}

export class ApiError extends Error {
  problem: ProblemError;
  constructor(problem: ProblemError) {
    super(problem.detail ?? problem.title);
    this.problem = problem;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let problem: ProblemError = { status: res.status, title: res.statusText };
    try {
      problem = { ...problem, ...(await res.json()) };
    } catch {
      // respuesta sin cuerpo JSON
    }
    throw new ApiError(problem);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
