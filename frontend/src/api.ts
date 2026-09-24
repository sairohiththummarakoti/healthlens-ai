import type { Analysis, ChatResponse, Patient } from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('Cannot reach the local service. Check that the HealthLens server is running, then try again.');
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status}). Please try again.`;
    try {
      const error = await response.json();
      detail = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail ?? detail);
    } catch { /* A proxy failure might not return JSON. */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; explanation_mode: string; version: string }>('/health'),
  patients: () => request<{ patients: Patient[] }>('/patients'),
  analyze: (id: string) => request<{ analysis_id: string }>(`/analyze/${encodeURIComponent(id)}`, { method: 'POST' }),
  analysis: (id: string) => request<Analysis>(`/analysis/${encodeURIComponent(id)}`),
  chat: (analysisId: string, question: string, previousMeasurements: string[]) => request<ChatResponse>('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId, question, previous_measurements: previousMeasurements }),
  }),
  upload: (file: File) => {
    const data = new FormData();
    data.append('file', file);
    return request<{ patients: Patient[]; message: string }>('/upload', { method: 'POST', body: data });
  },
  reset: () => request<{ message: string }>('/data', { method: 'DELETE' }),
};
