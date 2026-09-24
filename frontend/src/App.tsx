import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, Database, Download, FileJson, FileText, HeartPulse, LayoutDashboard, LoaderCircle, MessageCircle, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, Upload, Users, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from './api';
import type { Analysis, ChatResponse, Evidence, Patient, Trend } from './types';

const disclaimer = 'HealthLens AI is an informational prototype and does not provide medical diagnosis or treatment advice. Discuss health concerns with a qualified healthcare professional.';
const questions = ['What changed the most?', 'What increased consistently?', 'What stayed stable?'];
const number = (value: number) => Number.isInteger(value) ? String(value) : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const percentage = (value: number | null) => value === null ? 'Not available' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const yearsLabel = (years: number[]) => !years.length ? 'No dated records' : years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
const modeLabel = (mode: string) => /llm|openai/i.test(mode) && !/unavailable|fallback/i.test(mode) ? `Language model · ${mode}` : 'Deterministic explanation';

function Modal({ title, subtitle, close, children, wide = false }: { title: string; subtitle?: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select, textarea, [tabindex="0"]') ?? []).filter(el => el.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = focusables();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = originalOverflow; prior?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
      <header className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></header>
      {children}
    </div>
  </div>;
}

function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [metric, setMetric] = useState('LDL');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All measurements');
  const [modal, setModal] = useState<'patients' | 'upload' | 'activity' | 'reset' | 'about' | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  const [errorContext, setErrorContext] = useState<'patients' | 'analysis' | 'reset'>('patients');
  const [notice, setNotice] = useState('');
  const [explanationMode, setExplanationMode] = useState('unavailable');
  const [chat, setChat] = useState<{ question: string; response: ChatResponse }[]>([]);
  const [question, setQuestion] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false);
  const chatBottom = useRef<HTMLDivElement>(null);
  const chatGeneration = useRef(0);
  const activeChatRequest = useRef<{ generation: number; analysisId: string } | null>(null);
  const lastAnalysisPatient = useRef<string | null>(null);
  const currentPatient = patients.find(patient => patient.id === (analysis?.patient_id ?? selectedPatient));
  const completed = analysis?.status === 'completed';
  const processing = starting || (!!job && !['completed', 'failed'].includes(analysis?.status ?? ''));
  const analysisFailed = errorContext === 'analysis' && !!error && !processing;
  const chosenTrend = analysis?.trends.find(trend => trend.measurement === metric) ?? analysis?.trends[0];

  function invalidateConversation() {
    // Pending answers belong to exactly one analysis, even if a later patient reuses a metric.
    chatGeneration.current += 1;
    activeChatRequest.current = null;
    setChat([]); setChatBusy(false); setChatError(''); setQuestion(''); setEvidence(null);
  }

  async function loadPatients() {
    setPatientsLoading(true);
    try {
      const result = await api.patients();
      setPatients(result.patients);
      setSelectedPatient(previous => result.patients.some(patient => patient.id === previous) ? previous : result.patients[0]?.id ?? '');
      setError('');
    } catch (error) { setErrorContext('patients'); setError((error as Error).message); }
    finally { setPatientsLoading(false); }
  }

  useEffect(() => {
    void loadPatients();
    api.health().then(result => setExplanationMode(result.explanation_mode)).catch(() => setExplanationMode('unavailable'));
    return () => {
      chatGeneration.current += 1;
      activeChatRequest.current = null;
    };
  }, []);

  useEffect(() => {
    if (!job) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.analysis(job);
        if (!active) return;
        setAnalysis(result);
        setError('');
        if (result.status === 'completed') {
          setMetric(result.trends.some(trend => trend.measurement === 'LDL') ? 'LDL' : result.trends[0]?.measurement ?? '');
          setJob(null);
        } else if (result.status === 'failed') {
          setErrorContext('analysis');
          setError(result.error || 'Analysis failed. Please retry the patient analysis.');
          setJob(null);
        } else timer = setTimeout(poll, 500);
      } catch (error) {
        if (active) { setErrorContext('analysis'); setError((error as Error).message); setJob(null); }
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [job]);

  useEffect(() => { if (chat.length) chatBottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [chat]);

  async function analyze(patientId = selectedPatient) {
    if (!patientId || starting) return;
    invalidateConversation();
    lastAnalysisPatient.current = patientId;
    setStarting(true); setError(''); setNotice(''); setModal(null); setAnalysis(null); setQuery(''); setFilter('All measurements');
    setSelectedPatient(patientId);
    try { const result = await api.analyze(patientId); setJob(result.analysis_id); }
    catch (error) { setErrorContext('analysis'); setError((error as Error).message); }
    finally { setStarting(false); }
  }

  async function ask(value: string) {
    if (!analysis || analysis.status !== 'completed' || activeChatRequest.current || !value.trim()) return;
    const request = { generation: ++chatGeneration.current, analysisId: analysis.id };
    activeChatRequest.current = request;
    const isCurrent = () => chatGeneration.current === request.generation
      && activeChatRequest.current?.generation === request.generation
      && activeChatRequest.current?.analysisId === request.analysisId;
    setChatBusy(true); setChatError(''); setQuestion('');
    try {
      const response = await api.chat(request.analysisId, value.trim(), chat[chat.length - 1]?.response.measurements ?? []);
      if (isCurrent()) setChat(previous => [...previous, { question: value.trim(), response }]);
    } catch (error) {
      if (isCurrent()) { setChatError((error as Error).message); setQuestion(value); }
    } finally {
      if (isCurrent()) { activeChatRequest.current = null; setChatBusy(false); }
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!uploadFile || !syntheticConfirmed) return;
    if (uploadFile.size > 2 * 1024 * 1024) { setUploadError('This file is larger than 2 MB. Choose a smaller CSV or JSON file.'); return; }
    setUploadBusy(true); setUploadError('');
    try {
      const result = await api.upload(uploadFile);
      await loadPatients();
      setSelectedPatient(result.patients[0]?.id ?? '');
      setNotice(result.message); setModal('patients'); setUploadFile(null); setSyntheticConfirmed(false);
    } catch (error) { setUploadError((error as Error).message); }
    finally { setUploadBusy(false); }
  }

  async function reset() {
    invalidateConversation();
    setResetBusy(true);
    try {
      const result = await api.reset();
      lastAnalysisPatient.current = null;
      setJob(null); setAnalysis(null); setSelectedPatient(''); setModal(null); setNotice(result.message);
      await loadPatients();
    } catch (error) { setErrorContext('reset'); setError((error as Error).message); }
    finally { setResetBusy(false); }
  }

  function openEvidence(trend: Trend) {
    const entry = analysis?.evidence.find(item => item.id === trend.evidence_id);
    if (entry) setEvidence(entry);
  }

  const stageList = <div className="stage-list">{analysis?.stages.length ? analysis.stages.map((stage, index) => <div className={`stage stage-${stage.status}`} key={stage.name}>
    <div className="stage-icon">{stage.status === 'completed' ? <Check size={16} /> : stage.status === 'running' ? <LoaderCircle size={16} className="spin" /> : stage.status === 'failed' ? <X size={16} /> : <span>{index + 1}</span>}</div>
    <div><div className="stage-title"><strong>{stage.name}</strong><span>{stage.status}</span></div><p>{stage.detail || 'Waiting to run'}</p>{stage.completed_at && <time>{new Date(stage.completed_at).toLocaleTimeString()}</time>}</div>
  </div>) : <p className="muted">Agent activity appears when an analysis starts.</p>}</div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); if (!processing) { invalidateConversation(); lastAnalysisPatient.current = null; setAnalysis(null); setError(''); setModal(null); } }} aria-label="HealthLens AI home"><span className="brand-icon"><HeartPulse size={25} strokeWidth={1.8} /></span><span>HealthLens<span className="brand-ai">AI</span></span></a>
      <div className="workspace-label">YOUR HEALTH, IN CONTEXT</div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${!modal ? 'active' : ''}`} onClick={() => setModal(null)}><LayoutDashboard size={19} /> Overview</button>
        <button className={`nav-item ${modal === 'patients' ? 'active' : ''}`} onClick={() => setModal('patients')} disabled={processing}><Users size={19} /> Patient explorer <span className="nav-count">{patients.length}</span></button>
        <button className={`nav-item ${modal === 'activity' ? 'active' : ''}`} onClick={() => setModal('activity')}><Activity size={19} /> Agent activity{processing && <span className="live-dot" />}</button>
      </nav>
      <div className="sidebar-note"><div className="note-symbol"><ShieldCheck size={24} /></div><h3>Every insight has a source.</h3><p>Follow each finding back to the records behind it.</p><button onClick={() => setModal('about')}>How HealthLens works <ArrowUpRight size={15} /></button></div>
      <div className="sidebar-bottom"><span className="local-status"><span className="live-dot" /> Local demonstration</span><button className="subtle-button" onClick={() => setModal('reset')} disabled={processing}><Trash2 size={15} /> Reset local data</button><div className="profile"><span className="profile-avatar">HL</span><div><strong>Research workspace</strong><span>Synthetic data · MVP 1.0</span></div></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{completed ? 'Health overview' : 'Overview'}</strong></div><div className="topbar-actions"><span className="demo-badge"><span /> Synthetic data demo</span><button className="icon-button" aria-label="About HealthLens" onClick={() => setModal('about')}><CircleHelp size={19} /></button><span className="top-avatar">HL</span></div></header>
      <main id="main-content">
        {error && <div className="banner error-banner" role="alert"><span>{error}</span><button onClick={() => errorContext === 'analysis' ? void analyze(lastAnalysisPatient.current ?? selectedPatient) : errorContext === 'reset' ? void reset() : void loadPatients()}>Retry</button></div>}
        {notice && <div className="banner notice-banner" role="status"><CheckCheck size={18} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
        {processing || analysis?.status === 'failed' || analysisFailed ? <section className="processing-view">
          <div className={`processing-symbol ${processing ? 'is-processing' : ''}`}>{processing ? <Activity size={32} /> : <CircleHelp size={32} />}</div>
          <span className="eyebrow">{selectedPatient} · ANALYSIS</span><h1>{processing ? 'Connecting your health history.' : 'Let’s try that again.'}</h1><p>Each step builds on the last. Calculations are checked against the original records before the story is written.</p>
          <div className="panel processing-panel" aria-live="polite">{starting ? <div className="waiting"><LoaderCircle className="spin" size={22} /> Requesting analysis…</div> : stageList}</div>
          {(analysis?.status === 'failed' || analysisFailed) && <button className="button primary" onClick={() => void analyze(lastAnalysisPatient.current ?? selectedPatient)}>Retry analysis <ArrowRight size={17} /></button>}
          <span className="processing-footnote"><ShieldCheck size={15} /> Status reflects actual agent execution</span>
        </section> : completed && analysis ? <>
          <section className="page-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h1>Your health, over time<span className="heading-dot">.</span></h1><p>A clearer view of what changed, what stayed steady, and why.</p></div><button className="patient-switcher" onClick={() => setModal('patients')}><span className="patient-mini"><Users size={18} /></span><span><small>Selected patient</small><strong>{analysis.patient_id}</strong></span><ChevronDown size={17} /></button></section>
          <div className="context-row"><span><span className="live-dot" /> Analysis complete</span><span><Database size={14} /> {currentPatient?.source ?? 'Local source'}</span><span>{yearsLabel(analysis.years)}</span><button onClick={() => { setUploadError(''); setModal('upload'); }}><Plus size={15} /> Add records</button></div>
          <section className="stats-grid" aria-label="Analysis totals">{[
            { label: 'Years of history', value: analysis.stats.years_analyzed, icon: BookOpen, caption: yearsLabel(analysis.years) },
            { label: 'Measurements', value: analysis.stats.measurements_compared, icon: BarChart3, caption: 'Compared across records' },
            { label: 'Changes identified', value: analysis.stats.changes_identified, icon: Activity, caption: 'Descriptive trends' },
            { label: 'Findings verified', value: analysis.stats.findings_verified, icon: ShieldCheck, caption: 'Checked against the source' },
          ].map(stat => <article className="stat-card" key={stat.label}><div className="stat-top"><span>{stat.label}</span><stat.icon size={18} /></div><strong>{stat.value.toString().padStart(2, '0')}</strong><small>{stat.caption}</small></article>)}</section>
          <div className="dashboard-columns"><div className="insights-column">
            <section className="story-card"><div className="section-top"><span className="section-kicker"><Sparkles size={17} /> YOUR HEALTH STORY</span><span className="verified-badge"><ShieldCheck size={13} /> {analysis.stats.findings_verified} verified findings</span></div><h2>Small details. A more complete story.</h2><p className="story-text">{analysis.summary}</p><div className="story-bottom"><span><span className="mode-dot" /> {modeLabel(analysis.explanation_mode)}</span><button onClick={() => setModal('activity')}>See how it was built <ArrowRight size={14} /></button></div></section>
            {analysis.warnings.length > 0 && <div className="data-notes"><strong>Notes about these records</strong>{analysis.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
            <section className="panel chart-panel"><div className="section-heading"><div><span className="eyebrow">A CLOSER LOOK</span><h2>Trends through time</h2></div><label className="chart-select-label"><span className="sr-only">Chart measurement</span><select value={chosenTrend?.measurement ?? ''} onChange={event => setMetric(event.target.value)}>{analysis.trends.map(trend => <option key={trend.measurement}>{trend.measurement}</option>)}</select></label></div>
              {chosenTrend ? <><div className="chart-meta"><div><span className="metric-name">{chosenTrend.measurement}</span><strong>{number(chosenTrend.latest_value)} <small>{chosenTrend.unit}</small></strong></div><div className="chart-change"><span className={`direction direction-${chosenTrend.direction.toLowerCase().replaceAll(' ', '-')}`}>{chosenTrend.direction === 'Decreasing' ? <ArrowDownLeft size={15} /> : <Activity size={15} />}{chosenTrend.direction}</span><p>{percentage(chosenTrend.percentage_change)} <span>overall change</span></p></div></div>
                <div className="change-summary"><span>{number(chosenTrend.first_value)} <ArrowRight size={12} /> {number(chosenTrend.latest_value)} {chosenTrend.unit}</span><span>{signed(chosenTrend.absolute_change)} {chosenTrend.unit} overall</span></div>
                <div className="chart" role="img" aria-label={`${chosenTrend.measurement} values: ${chosenTrend.observations.map(item => `${date(item.date)}: ${number(item.value)} ${item.unit}`).join('; ')}`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chosenTrend.observations.map(item => ({ ...item, label: item.date.slice(0, 4) }))} margin={{ top: 20, right: 24, bottom: 12, left: -14 }}><CartesianGrid vertical={false} stroke="#e9ede7" strokeDasharray="4 4" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(0, 4)} tickLine={false} axisLine={false} tick={{ fill: '#81908a', fontSize: 12 }} dy={12} /><YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} tick={{ fill: '#81908a', fontSize: 12 }} /><Tooltip contentStyle={{ border: '1px solid #dce5df', borderRadius: 10, color: '#183b37' }} labelFormatter={label => date(String(label))} formatter={value => [`${number(Number(value))} ${chosenTrend.unit}`, chosenTrend.measurement]} /><Line type="linear" dataKey="value" stroke="#218475" strokeWidth={3} dot={{ fill: '#fff', strokeWidth: 3, r: 5 }} activeDot={{ r: 7 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
                <div className="chart-footer"><span><span className="chart-legend-dot" /> Recorded {chosenTrend.measurement} · {chosenTrend.unit}</span><button className="text-button" onClick={() => openEvidence(chosenTrend)}><ShieldCheck size={15} /> View source evidence <ArrowUpRight size={14} /></button></div>
              </> : <div className="empty-state">No comparable measurements are available in these records.</div>}
            </section>
            <section className="measurements-section"><div className="section-heading"><div><span className="eyebrow">EXPLORE THE DETAILS</span><h2>Your measurements <span className="count-badge">{analysis.trends.length}</span></h2></div></div><div className="measurement-tools"><label className="search-field"><Search size={16} /><input aria-label="Search measurements" placeholder="Search measurements…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter measurements" value={filter} onChange={event => setFilter(event.target.value)}>{['All measurements', 'Increasing', 'Decreasing', 'Stable', 'Fluctuating', 'Insufficient Data'].map(value => <option key={value}>{value}</option>)}</select></div>
              <div className="metric-grid">{analysis.trends.filter(trend => trend.measurement.toLowerCase().includes(query.toLowerCase()) && (filter === 'All measurements' || trend.direction === filter)).map(trend => <article className={`metric-card ${chosenTrend?.measurement === trend.measurement ? 'selected' : ''}`} key={trend.measurement}><button className="metric-select" onClick={() => setMetric(trend.measurement)} aria-label={`Show ${trend.measurement} chart`} aria-pressed={chosenTrend?.measurement === trend.measurement}><div className="metric-card-top"><h3>{trend.measurement}</h3>{trend.verified && <ShieldCheck size={16} aria-label="Verified" />}</div><div className="metric-value">{number(trend.latest_value)} <span>{trend.unit}</span></div><div className="metric-card-bottom"><span>{trend.direction}</span><strong>{percentage(trend.percentage_change)}</strong></div></button><button className="metric-evidence" onClick={() => openEvidence(trend)}>View evidence <ArrowUpRight size={13} /></button></article>)}</div>
              {!analysis.trends.some(trend => trend.measurement.toLowerCase().includes(query.toLowerCase()) && (filter === 'All measurements' || trend.direction === filter)) && <div className="empty-state">No measurements match this search.</div>}
            </section>
          </div><aside className="right-column">
            <section className="panel chat-panel"><header className="chat-header"><span className="assistant-icon"><Sparkles size={20} /></span><div><h2>Ask your history</h2><p>Curiosity, backed by evidence.</p></div></header><div className="chat-messages" aria-live="polite">
              <div className="chat-intro"><span className="eyebrow">LET’S MAKE SENSE OF IT</span><p>I can help you explore changes in these records. Every answer connects back to the measurements.</p></div>
              <div className="prompt-chips">{questions.map(prompt => <button key={prompt} disabled={chatBusy} onClick={() => void ask(prompt)}>{prompt}<ArrowUpRight size={14} /></button>)}</div>
              {chat.map((entry, index) => <div className="chat-entry" key={`${index}-${entry.question}`}><p className="question-bubble">{entry.question}</p><div className="answer-bubble"><span className="answer-label"><Sparkles size={13} /> HEALTHLENS</span><p>{entry.response.answer}</p><span className="answer-mode">{modeLabel(entry.response.explanation_mode)}</span>{entry.response.evidence.length > 0 && <div className="chat-evidence">{entry.response.evidence.map(item => <button onClick={() => setEvidence(item)} key={item.id}><ShieldCheck size={12} /> {item.measurement}<ArrowUpRight size={12} /></button>)}</div>}<details className="chat-agents"><summary>Agents used ({entry.response.agents_used.length})</summary><p>{entry.response.agents_used.join(' → ')}</p></details></div></div>)}
              {chatBusy && <div className="chat-loading" role="status"><LoaderCircle className="spin" size={15} /> Checking the verified record…</div>}{chatError && <div className="inline-error" role="alert">{chatError}</div>}<div ref={chatBottom} />
            </div><form className="chat-form" onSubmit={event => { event.preventDefault(); void ask(question); }}><label className="sr-only" htmlFor="question">Ask a question about these records</label><textarea id="question" placeholder="Ask about these records…" rows={2} maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(question); } }} /><button aria-label="Send question" disabled={chatBusy || !question.trim()}><Send size={17} /></button></form><p className="chat-footnote">Grounded in records. For understanding, not diagnosis.</p></section>
            <section className="panel activity-panel"><div className="section-heading"><h2>Behind the insights</h2><span className="activity-dot" /></div><p className="section-description">A transparent, four-agent workflow.</p>{stageList}<button className="activity-link" onClick={() => setModal('activity')}>View full activity <ArrowRight size={15} /></button></section>
          </aside></div>
        </> : <>
          <section className="home-heading"><span className="eyebrow">WELCOME TO HEALTHLENS</span><div className="home-topline"><h1>A little perspective.<br />A clearer health story<span className="heading-dot">.</span></h1><span className="edition">HEALTH HISTORY<br />MEETS UNDERSTANDING</span></div></section>
          <section className="welcome-card"><div className="welcome-copy"><span className="pill-label"><span className="live-dot" /> EVIDENCE FIRST. ALWAYS.</span><h2>Your records have a story.<br /><em>Let’s connect the dots.</em></h2><p>Explore years of health measurements in one thoughtful view. See what changed, ask better questions, and trace every insight to its source.</p><div className="hero-actions"><button className="button primary" onClick={() => setModal('patients')} disabled={patientsLoading}><span>{patientsLoading ? 'Loading patients…' : 'Explore Sample Patient'}</span>{patientsLoading ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}</button><button className="button outline" onClick={() => { setUploadError(''); setModal('upload'); }}><Upload size={17} /> Upload records</button></div><div className="welcome-caption"><ShieldCheck size={15} /> Anonymous synthetic records. No sign-in needed.</div></div><div className="welcome-art" aria-hidden="true"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="art-line line-one" /><div className="art-line line-two" /><div className="art-card art-record"><span className="art-icon"><FileText size={22} /></span><strong>The records</strong><span>Your history, together</span><div className="mock-line" /><div className="mock-line short" /></div><div className="art-lens"><HeartPulse size={42} strokeWidth={1.3} /><span>HealthLens</span></div><div className="art-card art-insight"><span className="art-check"><ShieldCheck size={18} /> Verified understanding</span><strong>A clearer perspective</strong><svg viewBox="0 0 220 60"><path d="M0 48 Q32 52 55 32 T110 34 T165 18 T220 8" fill="none" stroke="#409184" strokeWidth="3" /><circle cx="55" cy="32" r="4" fill="#d6eeb3" stroke="#409184" strokeWidth="2"/><circle cx="165" cy="18" r="4" fill="#d6eeb3" stroke="#409184" strokeWidth="2"/></svg></div><span className="art-caption">FROM INFORMATION TO UNDERSTANDING</span></div></section>
          <section className="how-section"><div className="section-heading"><div><span className="eyebrow">THOUGHTFULLY CONNECTED</span><h2>Four agents. One trustworthy picture.</h2></div><span className="section-description">Transparent at every step.</span></div><div className="how-grid">{[
            { icon: Database, title: 'Gather the history', text: 'Bring dated observations together, with their original sources.', step: '01' },
            { icon: BarChart3, title: 'Find the patterns', text: 'Calculate changes and consistency across the available years.', step: '02' },
            { icon: ShieldCheck, title: 'Verify the evidence', text: 'Check findings against the underlying values and arithmetic.', step: '03' },
            { icon: MessageCircle, title: 'Tell the story', text: 'Turn verified findings into a clear, grounded explanation.', step: '04' },
          ].map(item => <article className="how-card" key={item.step}><div><span className="how-icon"><item.icon size={21} /></span><span className="step-number">{item.step}</span></div><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
          <section className="sample-strip"><div><span className="sample-icon"><Users size={22} /></span><div><h3>A safe place to explore</h3><p>{patients.length ? `${patients.length} anonymous patient profiles are ready to explore.` : 'Start with anonymous sample records when the service is ready.'} Built for learning, using synthetic data.</p></div></div><button className="text-button" onClick={() => setModal('patients')}>Meet the sample patients <ArrowRight size={16} /></button></section>
        </>}
        <footer className="page-footer"><ShieldCheck size={17} /><p>{disclaimer}</p><span>HEALTHLENS AI</span></footer>
      </main>
    </div>

    {modal === 'patients' && <Modal title="Choose a patient history" subtitle="Anonymous demonstration records, ready to explore." close={() => setModal(null)}>
      {patientsLoading ? <div className="empty-state"><LoaderCircle size={20} className="spin" /> Loading patients…</div> : !patients.length ? <div className="empty-state">No patient records are available. Start the local service or upload synthetic records.</div> : <div className="patient-list">{patients.map(patient => <label className={`patient-option ${selectedPatient === patient.id ? 'chosen' : ''}`} key={patient.id}><input type="radio" name="patient" value={patient.id} checked={selectedPatient === patient.id} onChange={() => setSelectedPatient(patient.id)} /><span className="patient-option-icon"><Users size={20} /></span><span className="patient-option-info"><strong>{patient.id}</strong><span>{yearsLabel(patient.years)} · {patient.observation_count} observations</span><small>{patient.source}</small>{patient.source_url && <a href={patient.source_url} target="_blank" rel="noreferrer">View dataset source</a>}</span><span className="radio-indicator">{selectedPatient === patient.id && <Check size={13} />}</span></label>)}</div>}
      <div className="modal-actions"><button className="button outline" onClick={() => { setUploadError(''); setModal('upload'); }}><Upload size={16} /> Upload records</button><button className="button primary" disabled={!selectedPatient || processing || patientsLoading} onClick={() => void analyze()}>Analyze history <ArrowRight size={16} /></button></div><p className="modal-note">Records are synthetic. Trends describe recorded changes, not medical conclusions.</p>
    </Modal>}
    {modal === 'upload' && <Modal title="Bring a history into focus" subtitle="Upload synthetic CSV or JSON records to explore with HealthLens." close={() => { if (!uploadBusy) setModal(null); }}>
      <form onSubmit={event => void upload(event)}><label className="upload-zone"><Upload size={28} /><strong>{uploadFile?.name ?? 'Choose a CSV or JSON file'}</strong><span>{uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB · Click to choose another file` : 'Up to 2 MB · Maximum 10,000 observations'}</span><input type="file" accept=".csv,.json,text/csv,application/json" aria-label="Choose records file" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadError(''); }} /></label>
        <div className="schema-help"><div><FileJson size={17} /><strong>One observation per row or JSON object</strong></div><p>Required fields: <code>patient_id</code>, <code>date</code> (YYYY-MM-DD), <code>measurement</code>, <code>value</code> (number), <code>unit</code>. Optional: <code>reference_range</code>.</p><pre>{'[{"patient_id":"DEMO-001","date":"2024-01-15",\n  "measurement":"LDL","value":105,"unit":"mg/dL"}]'}</pre><a className="text-button" href="/api/sample.csv" download><Download size={15} /> Download example CSV</a></div>
        <label className="checkbox-label"><input type="checkbox" checked={syntheticConfirmed} onChange={event => setSyntheticConfirmed(event.target.checked)} /><span>These are synthetic demonstration records and contain no real patient information.</span></label>{uploadError && <p className="inline-error" role="alert">{uploadError}</p>}<div className="modal-actions"><button type="button" className="button outline" onClick={() => setModal(null)} disabled={uploadBusy}>Cancel</button><button className="button primary" disabled={!uploadFile || !syntheticConfirmed || uploadBusy}>{uploadBusy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{uploadBusy ? 'Validating records…' : 'Upload and validate'}</button></div>
      </form>
    </Modal>}
    {modal === 'activity' && <Modal title="A transparent path to every insight" subtitle={analysis ? `${analysis.patient_id} · ${analysis.status}` : 'Run a patient analysis to see actual agent activity.'} close={() => setModal(null)}>{stageList}<div className="mode-note"><Sparkles size={17} /><div><strong>{modeLabel(analysis?.explanation_mode ?? explanationMode)}</strong><p>Calculations and source verification are deterministic. Language output is labeled with the mode actually used.</p></div></div></Modal>}
    {modal === 'about' && <Modal title="Understanding, grounded in evidence" subtitle="HealthLens AI · Informational research prototype" close={() => setModal(null)}><div className="about-content"><p>HealthLens brings dated measurements into one view. A history agent retrieves records, a trend agent calculates changes, a verification agent checks the source, and an explanation agent describes verified findings.</p><p>“Increasing,” “decreasing,” and “stable” are descriptions of the numbers. They do not imply medical improvement or decline. Relative change rankings do not measure medical importance.</p><div className="mode-note"><ShieldCheck size={22} /><p>Bundled profiles are synthetic fixtures. Uploaded records retain their stated source. HealthLens runs as a local, single-user prototype.</p></div><p>{disclaimer}</p><button className="text-button" disabled={processing} onClick={() => setModal('reset')}><Trash2 size={14} /> Reset local data</button></div></Modal>}
    {modal === 'reset' && <Modal title="Reset local data?" subtitle="Start with a clean research workspace." close={() => { if (!resetBusy) setModal(null); }}><p className="reset-description">This deletes uploaded records, saved analyses, and the current conversation. The built-in synthetic patients remain available. This action cannot be undone.</p><div className="modal-actions"><button className="button outline" onClick={() => setModal(null)} disabled={resetBusy}>Keep my data</button><button className="button danger" onClick={() => void reset()} disabled={resetBusy}>{resetBusy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />} Reset local data</button></div></Modal>}
    {evidence && <Modal title={`${evidence.measurement} · Source evidence`} subtitle="Follow the finding back to the original observations." close={() => setEvidence(null)} wide><div className={`evidence-status ${evidence.verified ? '' : 'unverified'}`}><ShieldCheck size={20} /><div><strong>{evidence.verified ? 'Verified against original records' : 'Verification not passed'}</strong><p>{evidence.claim}</p></div></div><div className="evidence-table-wrap"><table className="evidence-table"><caption>Original observations · source values and units preserved</caption><thead><tr><th>Date</th><th>Value</th><th>Unit</th><th>Source record</th></tr></thead><tbody>{evidence.observations.map(item => <tr key={item.id}><td>{date(item.date)}</td><td><strong>{number(item.value)}</strong>{item.reference_range && <small>Source range: {item.reference_range}</small>}</td><td>{item.unit}</td><td><code>{item.id}</code><small>{item.source}</small></td></tr>)}</tbody></table></div><div className="calculation"><span className="eyebrow">CHECK THE MATH</span><p>{evidence.calculation}</p></div>{evidence.verification_notes.length > 0 && <ul className="verification-notes">{evidence.verification_notes.map((note, index) => <li key={index}><Check size={14} />{note}</li>)}</ul>}<p className="modal-note">Source evidence supports a descriptive change. It does not establish a diagnosis or treatment recommendation.</p></Modal>}
  </div>;
}

export default App;
