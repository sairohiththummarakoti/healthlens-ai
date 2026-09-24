import type { Analysis, ChatResponse, Patient } from './types';

async function request<T>(path: string, options?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api${path}`, { ...options, signal: controller.signal });
    if (!response.ok) {
      let detail = response.status >= 500
        ? 'The local service is unavailable. Check that the HealthLens server is running, then retry.'
        : `Request failed (${response.status}). Please try again.`;
      try {
        const error = await response.json();
        detail = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail ?? detail);
      } catch { /* A proxy failure might not return JSON. */ }
      throw new Error(detail);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new Error('The local service returned an unreadable response. Check the server and try again.');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(path === '/upload'
      ? 'Upload confirmation timed out. Check Patient explorer for an imported profile before uploading again.'
      : 'The local service took too long to respond. Check that the HealthLens server is running, then retry.');
    if (error instanceof TypeError) throw new Error('Cannot reach the local service. Check that the HealthLens server is running, then try again.');
    throw error;
  } finally { clearTimeout(timeout); }
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
  }, 65_000),
  upload: (file: File) => {
    const data = new FormData();
    data.append('file', file);
    return request<{ patients: Patient[]; message: string }>('/upload', { method: 'POST', body: data });
  },
  reset: () => request<{ message: string }>('/data', { method: 'DELETE' }),
};
