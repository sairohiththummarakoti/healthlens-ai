export interface Patient {
  id: string;
  source: string;
  source_url?: string;
  years: number[];
  observation_count: number;
}

export interface Observation {
  id: string;
  patient_id: string;
  date: string;
  measurement: string;
  value: number;
  unit: string;
  reference_range?: string;
  source: string;
  canonical_value?: number;
}

export interface Trend {
  measurement: string;
  unit: string;
  observations: Observation[];
  first_value: number;
  latest_value: number;
  absolute_change: number;
  percentage_change: number | null;
  direction: string;
  consistency: string;
  changes: {
    from_date: string;
    to_date: string;
    absolute_change: number;
    percentage_change: number | null;
    year_over_year: boolean;
  }[];
  verified: boolean;
  evidence_id: string;
}

export interface Evidence {
  id: string;
  measurement: string;
  claim: string;
  verified: boolean;
  observations: Observation[];
  calculation: string;
  verification_notes: string[];
}

export interface AgentStage {
  name: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  detail: string;
}

export interface Analysis {
  id: string;
  patient_id: string;
  status: string;
  created_at: string;
  stages: AgentStage[];
  summary: string;
  explanation_mode: string;
  years: number[];
  stats: {
    years_analyzed: number;
    measurements_compared: number;
    changes_identified: number;
    findings_verified: number;
  };
  trends: Trend[];
  evidence: Evidence[];
  warnings: string[];
  error?: string;
}

export interface ChatResponse {
  answer: string;
  evidence: Evidence[];
  agents_used: string[];
  explanation_mode: string;
  measurements: string[];
}
