import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowRight, AudioLines, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Download, ExternalLink, FileText, FlaskConical, Headphones, Lightbulb, ListChecks, LoaderCircle, LockKeyhole, MessageCircle, Mic, Monitor, Network, Pause, Pin, Play, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Target, Trash2, TriangleAlert, Volume2, X } from 'lucide-react';
import { AudioCapture } from './audio';
import { demoArtifact, demoMoment, moments } from './demo';
import { exportMarkdown, formatTime, isResponse, sortInsights } from './core';
import { meetingSpeakers, namedTranscript, relatedInsights, speakerId, upsertTranscript } from './speakers';
import { categories, defaultPrep, defaultSettings, type Artifact, type Category, type Insight, type Prep, type RunState, type Settings, type SpeakerProfiles, type Transcript } from './shared';

const meta: Record<Category, { label: string; icon: typeof BookOpen }> = {
  answer: { label: 'Suggested answer', icon: MessageCircle }, solution: { label: 'Possible solution', icon: Lightbulb },
  background: { label: 'Background', icon: BookOpen }, insight: { label: 'Insight', icon: Lightbulb },
  question: { label: 'Question', icon: MessageCircle }, terminology: { label: 'Terminology', icon: Sparkles },
  risk: { label: 'Risk & assumption', icon: TriangleAlert }, evidence: { label: 'Evidence', icon: ShieldCheck },
};
type View = 'workspace' | 'prep' | 'artifacts' | 'settings';
function errText(e: unknown) { return String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
function IconLabel({ icon: Icon, children }: { icon: typeof Mic; children: ReactNode }) { return <><Icon size={17} />{children}</>; }

export default function App() {
  const [view, setView] = useState<View>('workspace');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [prep, setPrep] = useState<Prep>(defaultPrep);
  const [hasKey, setHasKey] = useState(false);
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [deepgramKeyInput, setDeepgramKeyInput] = useState('');
  const [clearDeepgramKey, setClearDeepgramKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [state, setState] = useState<RunState>('idle');
  const [lines, setLines] = useState<Transcript[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [profiles, setProfiles] = useState<SpeakerProfiles>({});
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const [insightPage, setInsightPage] = useState(0);
  const [editSpeaker, setEditSpeaker] = useState(false);
  const [speakerName, setSpeakerName] = useState('');
  const [filter, setFilter] = useState<Category | 'all' | 'pinned'>('all');
  const [query, setQuery] = useState('');
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [highlight, setHighlight] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [demoCount, setDemoCount] = useState(0);
  const [activity, setActivity] = useState('Ready when you are');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [diagram, setDiagram] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [researchBusy, setResearchBusy] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const capture = useRef<AudioCapture | null>(null);
  const op = useRef(0);
  const epoch = useRef(0);
  const elapsedRef = useRef(0);
  const liveOffset = useRef(0);
  const demoRef = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const insightFeed = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const transcriptRevision = useRef(0);
  elapsedRef.current = elapsed;
  const active = state === 'listening' || state === 'connecting';
  const hasContent = lines.length > 0;

  useEffect(() => {
    window.companion.loadSettings().then(x => { setSettings(x.settings); setHasKey(x.hasKey); setHasDeepgramKey(x.hasDeepgramKey); }).catch(e => setError(errText(e)));
    const unsubscribe = window.companion.onEvent(e => {
      if (!['connecting', 'listening'].includes(stateRef.current)) return;
      if (e.type === 'transcript' || e.type === 'transcript-batch') {
        const items = (e.type === 'transcript' ? [e.item] : e.items).map(item => ({ ...item, at: item.at + liveOffset.current }));
        if (items.some(t => t.final)) { setArtifact(null); transcriptRevision.current++; }
        setLines(previous => upsertTranscript(previous, items, e.type === 'transcript-batch' ? e.replaceIds : []));
      }
      if (e.type === 'insights') setInsights(previous => [...e.items.map(i => ({ ...i, at: i.at + liveOffset.current })), ...previous]);
      if (e.type === 'activity') setActivity(e.message);
      if (e.type === 'error') {
        setError(e.message);
        if (e.fatal) {
          op.current++; stateRef.current = 'paused'; setState('paused'); setLevel(0); setConsent(false);
          void capture.current?.stop(); capture.current = null; void window.companion.stop();
          setLines(p => p.filter(t => t.final));
        }
      }
    });
    return () => { unsubscribe(); op.current++; void capture.current?.stop(); void window.companion.stop(); };
  }, []);
  useEffect(() => {
    if (state !== 'listening' || mode !== 'live') return;
    const timer = setInterval(() => setElapsed(s => s + 1), 1000); return () => clearInterval(timer);
  }, [state, mode]);
  useEffect(() => {
    if (state !== 'listening' || mode !== 'demo') return;
    const timer = setInterval(() => nextMoment(), 7500); return () => clearInterval(timer);
  }, [state, mode]);
  useEffect(() => { if (autoScroll && !transcriptQuery) transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [lines, autoScroll, transcriptQuery]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    if (!consentOpen && !resetOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
    modal?.querySelector<HTMLElement>(selector)?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setConsentOpen(false); setResetOpen(false); }
      if (e.key !== 'Tab') return;
      const targets = modal?.querySelectorAll<HTMLElement>(selector); if (!targets?.length) return;
      const first = targets[0], last = targets[targets.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [consentOpen, resetOpen]);

  function nextMoment() {
    const index = demoRef.current;
    if (index >= moments.length) return;
    const moment = demoMoment(index); demoRef.current++; setDemoCount(demoRef.current);
    setLines(p => [...p, moment.item]); setInsights(p => [...moment.cards, ...p]); setElapsed(index * 18 + 18);
    setActivity(index === moments.length - 1 ? 'Demo complete · recap ready' : 'Scripted insights · no cloud requests');
    if (index === moments.length - 1) { stateRef.current = 'ended'; setState('ended'); }
  }
  async function stopCapture(next: RunState) {
    const token = ++op.current; stateRef.current = next; setState(next); setConsent(false); setLevel(0);
    await capture.current?.stop(); capture.current = null; await window.companion.stop();
    if (token !== op.current) return;
    setLines(p => p.filter(t => t.final)); setActivity(next === 'ended' ? 'Session ended · review your recap' : next === 'idle' ? 'Ready when you are' : 'Paused · all audio capture stopped');
  }
  async function startLive() {
    if (!consent) return;
    setConsentOpen(false); setError(''); setArtifact(null);
    stateRef.current = 'connecting'; setState('connecting'); const token = ++op.current;
    liveOffset.current = elapsedRef.current;
    try {
      await window.companion.start({ consent: true, settings, prep, history: lines.filter(t => t.final), speakers: profiles });
      if (token !== op.current) return;
      const audio = new AudioCapture(); capture.current = audio;
      await audio.start(settings, (data, commit) => { if (token === op.current) window.companion.audio(data, commit); }, setLevel,
        () => { setError('The selected audio source disconnected. Capture stopped.'); void stopCapture('paused'); });
      if (token !== op.current) { await audio.stop(); return; }
      stateRef.current = 'listening'; setState('listening'); setActivity('Listening for useful context');
      const available = await navigator.mediaDevices.enumerateDevices(); setDevices(available.filter(d => d.kind === 'audioinput'));
    } catch (e) {
      if (token !== op.current) return;
      await stopCapture('paused'); setError(errText(e));
    }
  }
  function start() {
    setView('workspace'); setError('');
    if (mode === 'demo') { stateRef.current = 'listening'; setState('listening'); if (!demoRef.current) nextMoment(); }
    else if (!hasKey) { setView('settings'); setError('Add your OpenAI API key, save settings, then start a live session.'); }
    else if (settings.transcriptionProvider === 'deepgram' && !hasDeepgramKey) { setView('settings'); setError('Add your Deepgram API key and save settings to recognize speakers.'); }
    else { setConsent(false); setConsentOpen(true); }
  }
  async function reset() {
    epoch.current++; await stopCapture('idle'); demoRef.current = 0; setDemoCount(0); setElapsed(0); setLines([]); setInsights([]);
    setArtifact(null); setFilter('all'); setQuery(''); setTranscriptQuery(''); setExpanded(null); setError(''); setDiagram(false); setResetOpen(false);
    setProfiles({}); setSelectedSpeaker(null); setFollowLatest(true); setReviewIds(null); setInsightPage(0); setEditSpeaker(false); scrollInsightsToTop();
    setActivity('Ready when you are'); setView('workspace');
  }
  function changeMode(next: 'demo' | 'live') {
    setMode(next);
    if (next === 'live' && JSON.stringify(prep) === JSON.stringify(defaultPrep)) setPrep({ title: 'Untitled meeting', role: 'Participant', objective: 'Understand the discussion and identify useful follow-up questions.', agenda: '', glossary: '' });
    if (next === 'demo' && prep.title === 'Untitled meeting') setPrep(defaultPrep);
  }
  async function saveSettings() {
    setSaveBusy(true); setError('');
    try {
      await window.companion.saveSettings(settings, clearKey ? '' : keyInput || undefined, clearDeepgramKey ? '' : deepgramKeyInput || undefined);
      const result = await window.companion.loadSettings(); setHasKey(result.hasKey); setHasDeepgramKey(result.hasDeepgramKey); setSettings(result.settings);
      setKeyInput(''); setClearKey(false); setDeepgramKeyInput(''); setClearDeepgramKey(false); setNotice('Settings saved.');
    } catch (e) { setError(errText(e)); } finally { setSaveBusy(false); }
  }
  async function research(card: Insight) {
    if (researchBusy) return;
    if (mode === 'demo') { setExpanded(card.id); setNotice('Demo reference is provided below. No live fact check was performed.'); return; }
    setResearchBusy(card.id); const current = epoch.current;
    try {
      const result = await window.companion.research(card.body);
      if (current !== epoch.current) return;
      setInsights(p => p.map(i => i.id === card.id ? { ...i, detail: result.text, citations: result.citations,
        provenance: result.citations.length ? 'retrieved' : 'inference' } : i)); setExpanded(card.id);
    } catch (e) { setError(errText(e)); } finally { setResearchBusy(null); }
  }
  async function generateSummary() {
    if (mode === 'demo') { setArtifact(demoArtifact(demoCount)); return; }
    setSummaryBusy(true); const current = epoch.current, revision = transcriptRevision.current;
    try { const result = await window.companion.summarize(namedTranscript(lines, profiles), prep); if (current === epoch.current && revision === transcriptRevision.current) setArtifact(result); else setNotice('The conversation changed while the recap was generated. Generate it again to include the latest discussion.'); }
    catch (e) { setError(errText(e)); } finally { setSummaryBusy(false); }
  }
  async function exportSession() {
    try {
      const result = await window.companion.exportFile('Meeting Companion - ' + prep.title.slice(0, 65) + '.md',
        exportMarkdown(prep, namedTranscript(lines, profiles), insights, mode === 'demo' ? demoArtifact(demoCount) : artifact, mode === 'demo'));
      if (result) setNotice('Meeting exported. The file stays where you chose to save it.');
    } catch (e) { setError(errText(e)); }
  }
  function jumpTo(id: string) {
    setTranscriptQuery(''); setHighlight(id); setAutoScroll(false);
    setTimeout(() => document.getElementById('line-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }
  const speakers = meetingSpeakers(lines, profiles);
  const lastFinal = lines.filter(t => t.final).at(-1);
  const focusedSpeaker = followLatest && lastFinal ? speakerId(lastFinal, profiles) : selectedSpeaker;
  const focusedPerson = speakers.find(s => s.id === focusedSpeaker);
  const scopedCards = relatedInsights(insights, lines, profiles, focusedSpeaker);
  const scopedIds = new Set(scopedCards.map(card => card.id));
  const otherResponses = insights.filter(card => isResponse(card) && !scopedIds.has(card.id));
  const pendingCount = reviewIds ? scopedCards.filter(i => !reviewIds.includes(i.id)).length : 0;
  const pendingResponses = reviewIds ? scopedCards.filter(i => !reviewIds.includes(i.id) && isResponse(i)).length : 0;
  const visibleCards = sortInsights(scopedCards.filter(i => (!reviewIds || reviewIds.includes(i.id)) && (filter === 'all' || filter === 'pinned' && i.pinned || i.category === filter)
    && (!settings.quiet || isResponse(i) || i.priority === 'high' || i.pinned) && `${i.question || ''} ${i.title} ${i.body}`.toLowerCase().includes(query.toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(visibleCards.length / 2));
  const currentPage = Math.min(insightPage, pageCount - 1);
  const pageCards = visibleCards.slice(currentPage * 2, currentPage * 2 + 2);
  const displayLines = namedTranscript(lines, profiles);
  const visibleLines = displayLines.filter(t => `${t.speaker} ${t.text}`.toLowerCase().includes(transcriptQuery.toLowerCase()));
  useEffect(() => { setInsightPage(0); setExpanded(null); }, [focusedSpeaker, filter, query, settings.quiet]);
  useEffect(() => { insightFeed.current?.scrollTo(0, 0); }, [focusedSpeaker, filter, query, settings.quiet, currentPage]);
  useEffect(() => { setEditSpeaker(false); }, [focusedSpeaker]);
  useEffect(() => { if (active && mode === 'live') window.companion.updateSpeakers(profiles).catch(e => setError(errText(e))); }, [profiles, active, mode]);
  function selectSpeaker(id: string) {
    setSelectedSpeaker(id); setFollowLatest(false); setReviewIds(relatedInsights(insights, lines, profiles, id).map(i => i.id)); setInsightPage(0); setExpanded(null);
    scrollInsightsToTop();
  }
  function scrollInsightsToTop() { requestAnimationFrame(() => insightFeed.current?.scrollTo(0, 0)); }
  function holdReading() {
    if (followLatest) { setSelectedSpeaker(focusedSpeaker); setFollowLatest(false); setReviewIds(scopedCards.map(i => i.id)); }
  }
  function updateProfiles(next: SpeakerProfiles) { setProfiles(next); setArtifact(null); transcriptRevision.current++; }
  function markMe(checked: boolean) {
    if (!focusedPerson) return;
    const next = Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, { ...p, isMe: false }]));
    next[focusedPerson.id] = { ...next[focusedPerson.id], name: profiles[focusedPerson.id]?.name || '', isMe: checked }; updateProfiles(next);
  }
  function matchSpeaker(target: string) {
    if (!target || !focusedPerson || target === focusedPerson.id) return;
    const name = profiles[target]?.name || lines.find(t => speakerId(t, profiles) === target)?.speaker || 'Speaker';
    const next = { ...profiles, [focusedPerson.id]: { name: '', isMe: false, aliasOf: target },
      [target]: { ...profiles[target], name, isMe: !!profiles[target]?.isMe || !!profiles[focusedPerson.id]?.isMe } };
    updateProfiles(next); setSelectedSpeaker(target); setReviewIds(relatedInsights(insights, lines, next, target).map(i => i.id)); setEditSpeaker(false); setNotice('Speaker matched. Their transcript and insights are now grouped together.');
  }
  const recap = mode === 'demo' && hasContent ? demoArtifact(demoCount) : artifact;
  const sourceLabel = settings.source === 'microphone' ? 'Windows microphone' : settings.source === 'system' ? 'Windows system audio' : 'Microphone + system audio';
  const pageTitles: Record<View, string> = { workspace: 'A little context. A clearer conversation.', prep: 'Walk in with a head start.', artifacts: 'Turn the conversation into a plan.', settings: 'Make Companion yours.' };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={23} /></div><span>companion<span className="brand-dot">.</span><small>MEETING INTELLIGENCE</small></span></div>
      <button className="new-session" onClick={() => hasContent ? setResetOpen(true) : reset()}><Plus size={17}/> New session</button>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        {([['workspace', AudioLines, 'Live workspace'], ['prep', ClipboardList, 'Meeting prep'], ['artifacts', FileText, 'Meeting recap']] as const).map(([id, Icon, label]) =>
          <button key={id} className={'nav-item ' + (view === id ? 'selected' : '')} onClick={() => setView(id)}><Icon size={18}/>{label}{id === 'workspace' && state === 'listening' && <span className="nav-live"/>}</button>)}
      </nav>
      <div className="sidebar-session"><span className="nav-label">THIS SESSION</span><div className="session-name"><span className="tiny-dot"/>{prep.title}</div><span className="subtle">{mode === 'demo' ? 'Technical meeting demo' : 'Private personal session'}</span></div>
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={22}/><strong>Your conversation.<br/>Your control.</strong><p>Audio is never saved by this app. You choose what to export.</p></div>
        <button className={'nav-item ' + (view === 'settings' ? 'selected' : '')} onClick={() => setView('settings')}><Settings2 size={18}/>Settings<span className={'key-dot ' + (hasKey ? 'ready' : '')}/></button>
        <div className="profile"><div className="avatar">Y</div><div><strong>Personal workspace</strong><small>Desktop preview · v0.3</small></div></div>
      </div>
    </aside>
    <main>
      <header className="topbar"><div>Workspace <ChevronRight size={13}/><strong>{view === 'workspace' ? 'Live session' : view === 'prep' ? 'Meeting prep' : view === 'artifacts' ? 'Meeting recap' : 'Settings'}</strong></div><span className="private-status"><LockKeyhole size={13}/> Private session <span/>Nothing saved automatically</span></header>
      <div className={'page' + (view === 'workspace' && hasContent ? ' session-content' : '')}>
        <div className="page-heading"><div><div className="eyebrow">YOUR MEETING, WITH MORE CLARITY</div><h1>{pageTitles[view]}</h1><p>{view === 'workspace' ? 'Stay present. Get the context, questions, and insights that matter.' : view === 'prep' ? 'Give your copilot a little context before the conversation starts.' : view === 'artifacts' ? 'Review the evidence, confirm the details, and take the next step.' : 'Choose your audio, intelligence, and privacy preferences.'}</p></div>
          <div className="heading-actions">{view === 'workspace' && <span className="preview-badge">PERSONAL PREVIEW</span>}{view === 'artifacts' && <button className="button primary" disabled={!hasContent} onClick={exportSession}><Download size={16}/>Export Markdown</button>}</div>
        </div>
        {error && <div className="alert error" role="alert"><TriangleAlert size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}

        {view === 'workspace' && <>
          <section className="session-bar">
            <div className="meeting-icon"><Headphones size={22}/></div><div className="meeting-info"><strong>{prep.title}</strong><span>{mode === 'demo' ? 'Fictional team · Event-driven architecture' : sourceLabel}</span></div>
            <div className="mode-switch" aria-label="Session mode"><button disabled={active || hasContent} className={mode === 'demo' ? 'on' : ''} onClick={() => changeMode('demo')}><FlaskConical size={14}/>Demo</button><button disabled={active || hasContent} className={mode === 'live' ? 'on' : ''} onClick={() => changeMode('live')}><Mic size={14}/>Live</button></div>
            <span className="session-clock">{formatTime(elapsed)}</span>
            {state === 'listening' ? <><button className="button" onClick={() => stopCapture('paused')}><Pause size={15}/>Pause</button><button className="button end" onClick={() => stopCapture('ended')}><Square size={13}/>End</button></> : state === 'connecting' ? <button className="button" onClick={() => stopCapture('paused')}><LoaderCircle className="spin" size={16}/>Cancel</button> : state === 'ended' ? <button className="button primary" onClick={() => setView('artifacts')}>View recap<ArrowRight size={16}/></button> : <button className="button primary" onClick={start}><Play size={15}/>{state === 'paused' ? 'Resume session' : mode === 'demo' ? 'Run demo' : 'Start listening'}</button>}
          </section>
          <div className={'status-strip ' + (state === 'listening' ? 'running' : '')}>
            <span className={'status-dot ' + (state === 'listening' ? 'pulse' : '')}/><strong>{state === 'listening' ? mode === 'demo' ? 'Demo playing' : 'Listening' : state === 'paused' ? 'Capture paused' : state === 'ended' ? 'Session complete' : state === 'connecting' ? 'Connecting securely' : 'Ready to begin'}</strong>
            <span>{mode === 'demo' ? 'Scripted scenario · No audio captured or sent' : active ? `Audio → ${settings.transcriptionProvider === 'deepgram' ? 'Deepgram · Insights → OpenAI' : 'OpenAI'} · No raw audio saved` : 'Microphone and system audio are off'}</span>
            <div className="strip-right">{mode === 'demo' && state === 'listening' ? <button onClick={nextMoment}>Next moment<ArrowRight size={13}/></button> : <><ShieldCheck size={13}/><span>{mode === 'demo' ? 'No API key needed' : 'Consent required each start'}</span></>}</div>
          </div>
          <section className="panel speaker-panel" aria-label="Meeting speakers">
            <div className="speaker-panel-heading"><div><h2>Speakers</h2><p>{hasContent ? 'Choose a voice to review its related insights.' : 'Voices will appear here as Speaker 1, Speaker 2…'}</p></div><button className={'button follow-speaker ' + (followLatest ? 'following' : '')} aria-pressed={followLatest} onClick={() => { setFollowLatest(true); setReviewIds(null); setInsightPage(0); setEditSpeaker(false); }}><Activity size={14}/>{followLatest ? 'Following latest speaker' : 'Follow latest speaker'}</button></div>
            <div className="speaker-roster" role="group" aria-label="Select a speaker">
              <button className={'speaker-chip ' + (focusedSpeaker === '*' ? 'selected-speaker' : '')} aria-pressed={focusedSpeaker === '*'} onClick={() => selectSpeaker('*')}>All speakers<span>{insights.length} insights</span></button>
              {speakers.map((person, index) => <button key={person.id} aria-label={person.name + ' insights'} className={'speaker-chip ' + (focusedSpeaker === person.id ? 'selected-speaker' : '')} aria-pressed={focusedSpeaker === person.id} onClick={() => selectSpeaker(person.id)}><span className={'speaker-avatar avatar-' + index % 3}>{index + 1}</span><strong>{person.name}</strong><span>{relatedInsights(insights, lines, profiles, person.id).length} insights</span>{lastFinal && speakerId(lastFinal, profiles) === person.id && <small>Latest</small>}</button>)}
            </div>
            {focusedPerson && <div className="speaker-actions"><span>{followLatest ? 'Latest voice selected automatically' : 'Review held · new speech will not switch your selection'}</span>{otherResponses.length > 0 && <button className="other-responses" onClick={() => { selectSpeaker('*'); setFilter('all'); setQuery(''); }}><MessageCircle size={14}/>View {otherResponses.length} {otherResponses.length === 1 ? 'answer / solution' : 'answers / solutions'} from other speakers<ArrowRight size={14}/></button>}<button className="text-link" onClick={() => { holdReading(); setSpeakerName(profiles[focusedPerson.id]?.name || ''); setEditSpeaker(v => !v); }}>{editSpeaker ? 'Close speaker details' : 'Edit speaker'}</button></div>}
            {editSpeaker && focusedPerson && <form className="speaker-editor" onSubmit={e => { e.preventDefault(); updateProfiles({ ...profiles, [focusedPerson.id]: { ...profiles[focusedPerson.id], name: speakerName.trim(), isMe: !!profiles[focusedPerson.id]?.isMe } }); setNotice('Speaker name updated throughout this session.'); }}>
              <label>Speaker name<input maxLength={80} value={speakerName} placeholder="Optional name" onChange={e => setSpeakerName(e.target.value)}/></label><button className="button" type="submit">Save name</button>
              <label className="checkbox-row"><input type="checkbox" checked={!!profiles[focusedPerson.id]?.isMe} onChange={e => markMe(e.target.checked)}/>This is me</label>
              {speakers.length > 1 && <label>Same person as<select aria-label="Match speaker with an existing person" value="" onChange={e => matchSpeaker(e.target.value)}><option value="">Match another label…</option>{speakers.filter(p => p.id !== focusedPerson.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
              <small>Names and your selection last for this session. After resuming, match any new labels to existing people here. Voice separation can make mistakes, especially when people overlap.</small>
            </form>}
          </section>
          <div className="workspace-grid">
            <section className="insights-panel panel">
              <div className="panel-heading"><div><div className="section-title"><Sparkles size={18}/><h2>{focusedPerson ? focusedPerson.name : 'Meeting insights'}</h2><span className="count">{scopedCards.length}</span></div><p>{followLatest ? 'Insights related to the latest speaker’s discussion.' : 'Read at your pace. Load new insights when you’re ready.'}</p></div><button className={'icon-button ' + (settings.quiet ? 'active-icon' : '')} title={settings.quiet ? 'Show all priorities' : 'Quiet mode: answers, solutions, high-priority and pinned cards'} aria-label="Toggle quiet mode" aria-pressed={settings.quiet} onClick={() => setSettings(s => ({ ...s, quiet: !s.quiet }))}><Activity size={17}/></button></div>
              <div className="filters" aria-label="Insight category filters"><button className={filter === 'all' ? 'active-filter' : ''} onClick={() => setFilter('all')}>All insights</button>{categories.map(c => <button key={c} className={`${c} ${filter === c ? 'active-filter' : ''}`} onClick={() => setFilter(c)}><span/>{c === 'answer' ? 'Answers' : c === 'solution' ? 'Solutions' : c === 'risk' ? 'Risks' : meta[c].label}</button>)}<button aria-label="Show pinned insights" className={filter === 'pinned' ? 'active-filter' : ''} onClick={() => setFilter('pinned')}><Pin size={13}/></button></div>
              {hasContent && <div className="feed-tools"><div className="search-field"><Search size={14}/><input aria-label="Search insights" placeholder="Find an insight…" value={query} onChange={e => setQuery(e.target.value)}/></div>{pendingCount > 0 ? <button className="new-insights" onClick={() => { setReviewIds(scopedCards.map(i => i.id)); setInsightPage(0); setExpanded(null); scrollInsightsToTop(); }}>Load {pendingCount} new{pendingResponses > 0 && <span className="pending-responses">{pendingResponses} {pendingResponses === 1 ? 'answer / solution' : 'answers / solutions'}</span>}</button> : <span>{settings.quiet ? 'Quiet mode on' : followLatest ? 'Answers first' : 'Review held'}</span>}</div>}
              <div className="insight-feed" ref={insightFeed}>
                {!hasContent ? <div className="welcome">
                  <div className="welcome-art"><div className="art-ring"/><span className="floating-symbol symbol-one"><BookOpen size={23}/></span><span className="floating-symbol symbol-two"><MessageCircle size={23}/></span><span className="floating-symbol symbol-three"><Lightbulb size={22}/></span><div className="art-core"><AudioLines size={40}/></div></div>
                  <span className="mini-eyebrow">LESS CATCHING UP. MORE KEEPING UP.</span><h2>Your thinking partner,<br/>in the moment.</h2><p>See suggested answers to questions as they arise.<br/>Explore solutions, context, and useful follow-ups.</p>
                  <button className="button primary" disabled={active} onClick={start}>{mode === 'demo' ? <FlaskConical size={16}/> : <Mic size={16}/>} {mode === 'demo' ? 'Try the architecture review demo' : 'Start your first live session'}<ArrowRight size={15}/></button><small>{mode === 'demo' ? 'About a minute · No microphone or API key needed' : 'Requires consent and an OpenAI API key'}</small>
                  <div className="welcome-categories"><span><BookOpen size={14}/>Understand</span><span><Lightbulb size={14}/>Connect</span><span><MessageCircle size={14}/>Ask better</span></div>
                </div> : !visibleCards.length ? <div className="empty-filter"><Search size={25}/><h3>No matching insights</h3><p>{pendingCount ? 'New insights are waiting. Load them when you are ready.' : settings.quiet ? 'Quiet mode hides normal-priority cards. Turn it off to see more.' : scopedCards.length ? 'Try another category or search.' : 'No insights yet for this speaker. Select another speaker or wait for more discussion.'}</p><button className="button" onClick={() => { setFilter('all'); setQuery(''); setSettings(s => ({ ...s, quiet: false })); }}>Reset filters</button></div> : pageCards.map(card => {
                  const Icon = meta[card.category].icon, response = isResponse(card);
                  const open = expanded === card.id, detailId = `detail-${card.id}`;
                  const toggleDetails = () => {
                    holdReading(); setExpanded(open ? null : card.id);
                    if (response && !open) requestAnimationFrame(() => document.getElementById(detailId)?.scrollIntoView({ block: 'nearest' }));
                  };
                  return <article className={'insight-card ' + card.category + (response ? ' response-card' : '')} key={card.id}>
                    <div className="card-top"><span className="category-label"><Icon size={14}/>{meta[card.category].label}</span>{!response && card.priority === 'high' && <span className="priority-tag">Worth your attention</span>}<span className="card-time">{formatTime(card.at)}</span><button className={'icon-button pin-button ' + (card.pinned ? 'is-pinned' : '')} aria-label={card.pinned ? 'Unpin ' + card.title : 'Pin ' + card.title} onClick={() => setInsights(p => p.map(i => i.id === card.id ? { ...i, pinned: !i.pinned } : i))}><Pin size={13}/></button><button className="icon-button" aria-label={'Dismiss ' + card.title} onClick={() => setInsights(p => p.filter(i => i.id !== card.id))}><X size={14}/></button></div>
                    <h3>{card.title}</h3>{response ? <button className="response-summary" aria-label={(open ? 'Hide details: ' : 'Show details: ') + card.title} aria-expanded={open} aria-controls={detailId} onClick={toggleDetails}><span className="response-text">{card.body}</span><span className="response-more">{open ? 'Hide supporting details' : 'Explore supporting details'}<ChevronDown size={14} className={open ? 'rotate' : ''}/></span></button> : <p>{card.body}</p>}
                    {response && card.question && <p className="answered-question"><span>Question asked</span>{card.question}</p>}
                    {open && <div className="card-detail" id={detailId} role="region" aria-label={'Details: ' + card.title}>{response && <strong>Supporting details</strong>}<p>{card.detail}</p>{card.citations.map(c => <button className="source-link" key={c.url} onClick={() => window.companion.openSource(c.url).catch(e => setError(errText(e)))}><ExternalLink size={13}/>{c.title}</button>)}{card.category === 'evidence' && <small>{mode === 'demo' ? 'Illustrative documentation reference; no live verification performed.' : 'Sources inform a claim check; review their relevance and scope.'}</small>}</div>}
                    <div className="card-footer">{!response && <button aria-expanded={open} aria-controls={detailId} onClick={toggleDetails}>{open ? 'Less detail' : 'Why this matters'}<ChevronDown size={12} className={open ? 'rotate' : ''}/></button>}<button onClick={() => { holdReading(); jumpTo(card.triggerId); }}>View context<ArrowRight size={12}/></button>{card.category === 'evidence' && <button disabled={!!researchBusy} title="Live checks send this card to OpenAI web search" onClick={() => { holdReading(); void research(card); }}>{researchBusy === card.id ? <LoaderCircle className="spin" size={12}/> : <Search size={12}/>} {mode === 'demo' ? 'Reference' : 'Check sources'}</button>}<span>{card.provenance === 'demo' ? 'Demo example' : card.provenance === 'retrieved' ? 'Sources retrieved' : 'AI inference'}</span></div>
                  </article>;
                })}
              </div>
              {hasContent && <div className="insight-pagination" aria-label="Insight pages"><button aria-label="Previous insight page" disabled={currentPage === 0} onClick={() => { holdReading(); setInsightPage(currentPage - 1); setExpanded(null); }}>Previous</button><span>{visibleCards.length ? `${currentPage * 2 + 1}–${Math.min(currentPage * 2 + 2, visibleCards.length)} of ${visibleCards.length} insights` : '0 insights'}</span><button aria-label="Next insight page" disabled={currentPage + 1 >= pageCount} onClick={() => { holdReading(); setInsightPage(currentPage + 1); setExpanded(null); }}>Next</button></div>}
              <div className="feed-footer"><span className={state === 'listening' ? 'status-dot' : 'idle-dot'}/>{activity}<span className="footer-disclaimer">AI can be wrong. Keep your judgment.</span></div>
            </section>
            <aside className="transcript-panel panel">
              <div className="panel-heading"><div className="section-title"><AudioLines size={18}/><h2>Conversation</h2></div><span className="transcript-tag">{mode === 'demo' ? 'DEMO TRANSCRIPT' : 'LIVE TRANSCRIPT'}</span></div>
              <div className="transcript-tools"><div className="search-field"><Search size={14}/><input aria-label="Search transcript" placeholder="Search transcript" value={transcriptQuery} onChange={e => setTranscriptQuery(e.target.value)}/></div><button title="Follow newest transcript" aria-label="Toggle transcript auto-scroll" aria-pressed={autoScroll} className={'icon-button ' + (autoScroll ? 'active-icon' : '')} onClick={() => setAutoScroll(v => !v)}><ArrowDown size={15}/></button></div>
              <div className="transcript-content">
                {!hasContent ? <div className="transcript-empty"><div className="waveform idle">{Array.from({ length: 21 }, (_, i) => <span key={i} style={{ height: 6 + Math.sin(i * 1.7) ** 2 * 25 }}/>)}</div><h3>The conversation starts here.</h3><p>{mode === 'demo' ? 'Run the demo to follow a realistic technical discussion, one moment at a time.' : 'Start listening to see your transcript. No audio is captured while idle.'}</p><div className="transcript-tip"><Mic size={17}/><span>In-room meeting? Use your mic.<br/>On a call? Choose system audio.</span></div></div> : visibleLines.map((line, index) => <div className={'transcript-line ' + (highlight === line.id ? 'highlighted' : '') + (!line.final ? ' provisional' : '')} id={'line-' + line.id} key={line.id}><div className="speaker-line"><div className={'speaker-avatar avatar-' + index % 3}>{mode === 'demo' ? line.speaker[0] : <Mic size={11}/>}</div><button className="transcript-speaker" disabled={!line.final} aria-label={'Show insights for ' + line.speaker} onClick={() => selectSpeaker(line.speakerId!)}>{line.speaker}</button><time>{formatTime(line.at)}</time></div><p>{line.text}{!line.final && <span className="typing-cursor"/>}</p>{!line.final && <small>Provisional transcription</small>}</div>)}
                {hasContent && !visibleLines.length && <div className="empty-filter"><p>No matching transcript passages.</p></div>}<div ref={transcriptEnd}/>
              </div>
              <div className="audio-meter"><div className="waveform">{Array.from({ length: 25 }, (_, i) => <span key={i} style={{ height: mode === 'live' && state === 'listening' ? 4 + Math.min(26, level * 35) * (0.4 + Math.sin(i * 2) ** 2) : 4, opacity: state === 'listening' && mode === 'live' ? 1 : 0.35 }}/>)}</div><span>{mode === 'demo' ? 'Audio capture off' : active ? level > .03 ? 'Audio detected' : 'Waiting for audio' : 'Microphone off'}</span></div>
            </aside>
          </div>
          <div className="workspace-bottom"><span><LockKeyhole size={13}/>{mode === 'demo' ? 'Everything in this demo is fictional.' : 'No raw audio files. Transcript stays in memory until you export.'}</span><button onClick={() => setView('prep')}>Add meeting context<ArrowRight size={13}/></button></div>
        </>}

        {view === 'prep' && <div className="content-grid"><section className="panel form-panel"><div className="section-title"><Target size={20}/><h2>Set the scene</h2></div><p className="section-description">This context helps the assistant choose what is useful to you.</p>
          <label>Meeting title<input disabled={active || hasContent} value={prep.title} maxLength={300} onChange={e => setPrep(p => ({ ...p, title: e.target.value }))}/></label>
          <label>Your role<input disabled={active} value={prep.role} maxLength={500} onChange={e => setPrep(p => ({ ...p, role: e.target.value }))}/></label>
          <label>What would make this meeting useful?<textarea disabled={active} value={prep.objective} maxLength={4000} onChange={e => setPrep(p => ({ ...p, objective: e.target.value }))}/></label>
          <label>Agenda & background<textarea disabled={active} value={prep.agenda} maxLength={8000} onChange={e => setPrep(p => ({ ...p, agenda: e.target.value }))}/></label>
          <label>Names, acronyms & terminology<textarea disabled={active} value={prep.glossary} maxLength={8000} onChange={e => setPrep(p => ({ ...p, glossary: e.target.value }))}/></label>
          <div className="inline-note"><LockKeyhole size={15}/><span>Kept in memory. Sent to OpenAI when you use live assistance. {active && 'Pause capture to edit; updates apply on resume.'}</span></div><button className="button primary" onClick={() => { setView('workspace'); setNotice('Meeting context is ready for this session.'); }}>Ready for the conversation<ArrowRight size={16}/></button>
        </section><div className="prep-aside"><section className="panel guidance-card"><span className="large-icon"><CircleHelp size={25}/></span><h2>A few questions worth bringing</h2><div className="prep-question"><span>01</span><p>What decision are we trying to make today?</p></div><div className="prep-question"><span>02</span><p>Which constraints are fixed, and which are assumptions?</p></div><div className="prep-question"><span>03</span><p>What evidence would change our preferred approach?</p></div><small>Suggested preparation prompts, not meeting facts.</small></section><div className="prep-note"><Sparkles size={18}/><p>A specific objective makes for a quieter, more useful copilot.</p></div></div></div>}

        {view === 'artifacts' && <>
          <div className="recap-banner"><div className="large-icon"><ListChecks size={25}/></div><div><h2>{hasContent ? prep.title : 'Your recap will be ready here'}</h2><p>{hasContent ? `${mode === 'demo' ? 'Scripted demo' : 'Personal meeting'} · ${lines.filter(l => l.final).length} transcript passages · ${insights.length} insight cards` : 'Start a demo or live session to create a transcript and reviewable meeting artifacts.'}</p></div>{hasContent && mode === 'live' && <button className="button primary" disabled={summaryBusy} onClick={generateSummary}>{summaryBusy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {artifact ? 'Refresh recap' : 'Generate recap'}</button>}</div>
          {hasContent && <div className="inline-note recap-note"><TriangleAlert size={15}/><span>{mode === 'demo' ? 'Fictional discussion. This recap only includes demo moments already played.' : 'AI drafts require review. Generating a recap sends the current transcript and preparation to OpenAI.'} {active && 'The session is still running; new discussion may change this recap.'}</span></div>}
          <div className="recap-grid"><section className="panel recap-card wide"><div className="section-title"><FileText size={19}/><h2>Meeting brief</h2></div><p>{recap?.summary || (hasContent ? 'Generate a recap to summarize this discussion. You can export the transcript at any time.' : 'The meeting summary will appear here.')}</p></section>
            {([['decisions', 'Decisions', Check], ['actions', 'Action items', ListChecks], ['questions', 'Open questions', MessageCircle]] as const).map(([key, title, Icon]) => <section className="panel recap-card" key={key}><div className="section-title"><Icon size={18}/><h2>{title}</h2><span className="count">{recap?.[key].length || 0}</span></div>{recap?.[key].length ? <ul>{recap[key].map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="subtle">{key === 'decisions' ? 'No confirmed decisions captured.' : key === 'actions' ? 'No confirmed actions captured.' : 'No questions captured yet.'}</p>}</section>)}
          </div>
          <section className="panel diagram-panel"><div><div className="section-title"><Network size={19}/><h2>Architecture sketch</h2><span className="preview-badge">DEMO REFERENCE</span></div><p>An illustrative transactional outbox pattern. This diagram is a fixed example, not generated from your meeting.</p></div><button className="button" onClick={() => setDiagram(v => !v)}>{diagram ? 'Hide sketch' : 'Explore pattern'}<ChevronDown size={14}/></button>{diagram && <div className="architecture"><div className="diagram-node"><Monitor size={23}/><strong>Checkout service</strong><small>One local transaction</small></div><ArrowRight/><div className="diagram-node db"><FileText size={23}/><strong>Database + outbox</strong><small>Business data & event</small></div><ArrowRight/><div className="diagram-node"><Activity size={23}/><strong>Event relay</strong><small>Retry with backoff</small></div><ArrowRight/><div className="diagram-node"><Network size={23}/><strong>Broker → consumer</strong><small>Deduplicate event IDs</small></div><div className="diagram-caption">Design hypothesis · At-least-once delivery with idempotent effects · Validate transaction boundaries, replay policy, and latency.</div></div>}</section>
        </>}

        {view === 'settings' && <div className="settings-layout"><div>
          <section className="panel form-panel"><div className="section-title"><Mic size={19}/><h2>Audio input</h2></div><p className="section-description">Choose what Companion hears. Changes apply at the next start.</p><div className="source-options">{([['microphone', Mic, 'Microphone', 'In-room or external speakerphone'], ['system', Volume2, 'System audio', 'Zoom, Teams & all Windows playback'], ['both', Headphones, 'Both sources', 'Combined microphone and playback']] as const).map(([id, Icon, title, description]) => <button disabled={active} key={id} className={'source-option ' + (settings.source === id ? 'chosen' : '')} onClick={() => setSettings(s => ({ ...s, source: id }))}><Icon size={21}/><strong>{title}</strong><small>{description}</small>{settings.source === id && <Check size={15} className="chosen-check"/>}</button>)}</div>
          <label>Microphone device<select disabled={active || settings.source === 'system'} value={settings.deviceId} onChange={e => setSettings(s => ({ ...s, deviceId: e.target.value }))}><option value="">Windows default microphone</option>{devices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone ' + d.deviceId.slice(0, 5)}</option>)}{settings.deviceId && !devices.some(d => d.deviceId === settings.deviceId) && <option value={settings.deviceId}>Previously selected microphone</option>}</select></label><div className="inline-note"><Monitor size={15}/><span>System capture includes all sounds on the Windows default output, not just your meeting app. Both-source capture works best with headphones. Device names become available after your first permitted microphone capture.</span></div>
          </section>
          <section className="panel form-panel"><div className="section-title"><Sparkles size={19}/><h2>Intelligence</h2></div><p className="section-description">OpenAI powers insights and recaps. Deepgram adds live speaker separation. Keys stay in the desktop main process after saving.</p><label>OpenAI API key <span className="field-status">{hasKey ? 'Key configured' : 'Not configured'}</span><input type="password" autoComplete="off" disabled={active} placeholder={hasKey ? 'Leave blank to keep your current key' : 'sk-…'} value={keyInput} onChange={e => { setKeyInput(e.target.value); setClearKey(false); }}/></label>{hasKey && <label className="checkbox-row"><input type="checkbox" checked={clearKey} disabled={active} onChange={e => setClearKey(e.target.checked)}/>Remove configured key when saving</label>}
          <label>Transcription service<select disabled={active} value={settings.transcriptionProvider} onChange={e => setSettings(s => ({ ...s, transcriptionProvider: e.target.value as Settings['transcriptionProvider'] }))}><option value="deepgram">Deepgram · separate speakers from one source</option><option value="openai">OpenAI · transcription without speaker separation</option></select></label>
          {settings.transcriptionProvider === 'deepgram' && <><label>Deepgram API key <span className="field-status">{hasDeepgramKey ? 'Deepgram key configured' : 'Deepgram key not configured'}</span><input type="password" autoComplete="off" disabled={active} placeholder={hasDeepgramKey ? 'Leave blank to keep your current key' : 'Your Deepgram API key'} value={deepgramKeyInput} onChange={e => { setDeepgramKeyInput(e.target.value); setClearDeepgramKey(false); }}/></label>{hasDeepgramKey && <label className="checkbox-row"><input type="checkbox" checked={clearDeepgramKey} disabled={active} onChange={e => setClearDeepgramKey(e.target.checked)}/>Remove Deepgram key when saving</label>}<div className="inline-note"><AudioLines size={16}/><span>Deepgram Nova-3 separates voices from one microphone. Rename speakers and mark yourself during the session. Audio goes to Deepgram; transcript and meeting prep go to OpenAI for insights. Each service bills its own usage. No voice profile is saved between meetings.</span></div></>}
          <div className="two-fields"><label>Insight model<input disabled={active} value={settings.model} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}/></label>{settings.transcriptionProvider === 'openai' && <label>Transcription model<input disabled={active} value={settings.transcriptionModel} onChange={e => setSettings(s => ({ ...s, transcriptionModel: e.target.value }))}/></label>}</div>
          <label>Minimum time between insight requests<select disabled={active} value={settings.insightInterval} onChange={e => setSettings(s => ({ ...s, insightInterval: Number(e.target.value) }))}><option value={2000}>2 seconds · more responsive, more requests</option><option value={4000}>4 seconds · balanced</option><option value={8000}>8 seconds · fewer requests</option></select></label>
          <label className="toggle-row"><span><strong>Quiet mode</strong><small>Keep answers, solutions, high-priority and pinned cards visible.</small></span><input aria-label="Quiet mode setting" type="checkbox" role="switch" checked={settings.quiet} onChange={e => setSettings(s => ({ ...s, quiet: e.target.checked }))}/></label>
          <label className="toggle-row"><span><strong>Remember API keys on this computer</strong><small>Encrypt with Windows-backed storage. Off means this app session only.</small></span><input disabled={active} type="checkbox" role="switch" checked={settings.rememberKey} onChange={e => setSettings(s => ({ ...s, rememberKey: e.target.checked }))}/></label>
          </section><div className="settings-save"><span>{active ? 'Pause or end capture to save settings.' : 'Settings persist. Meeting content does not.'}</span><button className="button primary" disabled={saveBusy || active} onClick={saveSettings}>{saveBusy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save settings</button></div>
        </div><aside><section className="panel guidance-card privacy-card"><ShieldCheck size={29}/><h2>Privacy, by default</h2><ul><li><Check size={15}/>No saved raw audio files</li><li><Check size={15}/>Transcript held in memory</li><li><Check size={15}/>Explicit start and consent</li><li><Check size={15}/>Pause releases audio devices</li><li><Check size={15}/>Exports only when you ask</li></ul><p>With speaker separation, live audio goes to Deepgram. With OpenAI transcription, audio goes to OpenAI. OpenAI receives transcript context, preparation, recap requests, and claims you choose to check.</p><p>Cloud retention follows your provider account’s policies. “Nothing saved” describes this app, not provider-side retention.</p><button className="source-link" onClick={() => window.companion.openSource('https://platform.openai.com/docs/guides/your-data').catch(e => setError(errText(e)))}>OpenAI data controls<ExternalLink size={13}/></button><button className="source-link" onClick={() => window.companion.openSource('https://deepgram.com/privacy').catch(e => setError(errText(e)))}>Deepgram privacy<ExternalLink size={13}/></button></section><div className="prep-note"><FlaskConical size={18}/><p>Demo mode never opens an audio device or calls an AI provider.</p></div></aside></div>}
      </div>
    </main>
    {consentOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title"><button className="modal-close icon-button" aria-label="Close consent dialog" onClick={() => setConsentOpen(false)}><X size={20}/></button><div className="modal-icon"><Mic size={28}/></div><div className="eyebrow">YOU ARE IN CONTROL</div><h2 id="consent-title">Before we listen.</h2><p>Make sure everyone participating knows about the capture and AI processing, and that you have the permissions needed for this meeting.</p><div className="consent-facts"><div><Mic size={18}/><span><strong>Audio source</strong>{sourceLabel}</span></div><div><Sparkles size={18}/><span><strong>Processing destination</strong>{settings.transcriptionProvider === 'deepgram' ? 'Deepgram: audio and speaker separation. OpenAI: transcript context and meeting prep.' : 'OpenAI: audio, transcript context and meeting prep.'}</span></div><div><LockKeyhole size={18}/><span><strong>Local retention</strong>No raw audio saved. Transcript in memory until export.</span></div></div>{settings.source !== 'microphone' && <div className="inline-note"><TriangleAlert size={17}/><span>System audio includes all apps playing through the default Windows output. Video is discarded locally and never sent.</span></div>}<label className="consent-checkbox"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I have informed participants and obtained the consent and permissions needed for capture and cloud processing.</span></label><small className="consent-footnote">This acknowledgment does not notify participants or independently verify their consent. Pause stops capture and discards any unfinished speech segment.</small><button className="button primary" disabled={!consent} onClick={startLive}><Mic size={16}/>Start listening</button><button className="text-button" onClick={() => setConsentOpen(false)}>Keep audio off</button></section></div>}
    {resetOpen && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">Start a fresh session?</h2><p>This clears the current in-memory transcript, insights, and recap. Export anything you want to keep first.</p><div className="modal-actions"><button className="button" onClick={() => setResetOpen(false)}>Keep session</button><button className="button" onClick={exportSession}><Download size={15}/>Export first</button><button className="button primary" onClick={reset}>New session</button></div></section></div>}
  </div>;
}
