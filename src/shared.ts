export const categories = ['background', 'insight', 'question', 'terminology', 'risk', 'evidence'] as const;
export type Category = typeof categories[number];
export type AudioSource = 'microphone' | 'system' | 'both';
export type RunState = 'idle' | 'connecting' | 'listening' | 'paused' | 'ended';
export interface Settings {
  source: AudioSource; deviceId: string; model: string; transcriptionModel: string;
  transcriptionProvider: 'deepgram' | 'openai';
  quiet: boolean; insightInterval: number; rememberKey: boolean;
}
export const defaultSettings: Settings = {
  source: 'microphone', deviceId: '', model: 'gpt-4.1-mini', transcriptionModel: 'gpt-live-transcribe',
  transcriptionProvider: 'deepgram',
  quiet: false, insightInterval: 4000, rememberKey: false,
};
export interface Prep { title: string; role: string; objective: string; agenda: string; glossary: string }
export const defaultPrep: Prep = {
  title: 'Platform architecture review', role: 'Technical contributor',
  objective: 'Understand the tradeoffs and leave with a clear decision.',
  agenda: 'Event delivery guarantees, retry behavior, and a realistic latency budget.',
  glossary: 'SLO: service-level objective; DLQ: dead-letter queue; p99: 99th percentile',
};
export interface Transcript { id: string; speaker: string; speakerId?: string; speakerNumber?: number; text: string; at: number; final: boolean }
export interface SpeakerProfile { name: string; isMe: boolean; aliasOf?: string }
export type SpeakerProfiles = Record<string, SpeakerProfile>;
export interface Citation { title: string; url: string }
export interface Insight {
  id: string; category: Category; title: string; body: string; detail: string;
  triggerId: string; at: number; priority: 'normal' | 'high';
  provenance: 'demo' | 'inference' | 'retrieved'; citations: Citation[];
  pinned?: boolean;
}
export interface Artifact { summary: string; decisions: string[]; actions: string[]; questions: string[] }
export type ServiceEvent =
  | { type: 'transcript'; item: Transcript }
  | { type: 'transcript-batch'; items: Transcript[]; replaceIds: string[] }
  | { type: 'insights'; items: Insight[] }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'activity'; message: string };
export interface CompanionAPI {
  loadSettings(): Promise<{ settings: Settings; hasKey: boolean; hasDeepgramKey: boolean }>;
  saveSettings(settings: Settings, key?: string, deepgramKey?: string): Promise<void>;
  start(input: { consent: boolean; settings: Settings; prep: Prep; history: Transcript[]; speakers?: SpeakerProfiles }): Promise<void>;
  updateSpeakers(speakers: SpeakerProfiles): Promise<void>;
  stop(): Promise<void>;
  audio(data: ArrayBuffer, commit: boolean): void;
  research(claim: string): Promise<{ text: string; citations: Citation[] }>;
  summarize(transcript: Transcript[], prep: Prep): Promise<Artifact>;
  exportFile(name: string, text: string): Promise<boolean>;
  openSource(url: string): Promise<void>;
  onEvent(fn: (event: ServiceEvent) => void): () => void;
}
declare global { interface Window { companion: CompanionAPI } }
