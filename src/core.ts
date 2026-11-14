import { categories, defaultSettings, type Artifact, type Insight, type Prep, type Settings, type Transcript } from './shared';
export function validateSettings(value: unknown): Settings {
  const s = value as Settings;
  if (!s || !['microphone', 'system', 'both'].includes(s.source)) throw new Error('Choose a valid audio source.');
  if (s.transcriptionProvider !== undefined && !['deepgram', 'openai'].includes(s.transcriptionProvider)) throw new Error('Choose a valid transcription provider.');
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(s.model) || !/^[a-zA-Z0-9._-]{1,100}$/.test(s.transcriptionModel)) throw new Error('Model names must be valid API model identifiers.');
  return { ...defaultSettings, source: s.source, deviceId: String(s.deviceId || '').slice(0, 500), model: s.model,
    transcriptionProvider: s.transcriptionProvider || defaultSettings.transcriptionProvider,
    transcriptionModel: s.transcriptionModel, quiet: !!s.quiet, rememberKey: !!s.rememberKey,
    insightInterval: Math.max(2000, Math.min(15000, Number(s.insightInterval) || 4000)) };
}
export function safeUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
export function isResponse(card: Pick<Insight, 'category'>): boolean { return card.category === 'answer' || card.category === 'solution'; }
/** Responses lead every view, newest first within each kind. Sorting never mutates a held snapshot. */
export function sortInsights(cards: Insight[]): Insight[] {
  const rank = (card: Insight) => card.category === 'answer' ? 0 : card.category === 'solution' ? 1 : 2;
  return [...cards].sort((a, b) => rank(a) - rank(b) || b.at - a.at);
}
export function insightKey(card: Insight): string {
  return isResponse(card) ? `${card.category}:${card.triggerId}:${card.question?.trim().toLowerCase()}` : card.title.trim().toLowerCase();
}
export function parseInsights(raw: unknown, validIds: Set<string>, at: number): Insight[] {
  const list = (raw as { cards?: unknown[] })?.cards;
  if (!Array.isArray(list)) throw new Error('The model did not return insight cards.');
  const parsed = list.slice(0, 4).flatMap((v, i) => {
    if (!v || typeof v !== 'object') return [];
    const c = v as Record<string, unknown>;
    if (!categories.includes(c.category as never) || !validIds.has(String(c.triggerId)) || !c.title || !c.body) return [];
    const response = c.category === 'answer' || c.category === 'solution';
    if (response && (typeof c.question !== 'string' || !c.question.trim() || typeof c.detail !== 'string' || !c.detail.trim())) return [];
    return [{ id: `ai-${at}-${i}`, category: c.category as Insight['category'], title: String(c.title).slice(0, 160),
      body: String(c.body).slice(0, response ? 500 : 1400), detail: String(c.detail || '').slice(0, 2500), triggerId: String(c.triggerId),
      ...(response ? { question: String(c.question).trim().slice(0, 500) } : {}),
      at, priority: response || c.priority === 'high' ? 'high' : 'normal', provenance: 'inference', citations: [] } as Insight];
  });
  return sortInsights(parsed);
}
export const insightSchema = {
  type: 'object', properties: { cards: { type: 'array', items: { type: 'object',
    properties: { category: { type: 'string', enum: [...categories] }, title: { type: 'string' }, body: { type: 'string' }, detail: { type: 'string' }, question: { type: 'string' },
      triggerId: { type: 'string' }, priority: { type: 'string', enum: ['normal', 'high'] } },
    required: ['category', 'title', 'body', 'detail', 'question', 'triggerId', 'priority'], additionalProperties: false } } }, required: ['cards'], additionalProperties: false,
};
export const artifactSchema = { type: 'object', properties: {
  summary: { type: 'string' }, decisions: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'decisions', 'actions', 'questions'], additionalProperties: false };
export function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
export function exportMarkdown(prep: Prep, transcript: Transcript[], insights: Insight[], artifact: Artifact | null, demo: boolean) {
  return `# ${prep.title}\n\n${demo ? '> SCRIPTED DEMO — fictional participants and discussion.\n\n' : ''}> AI assistance may contain errors. Review before sharing.\n\n## Objective\n${prep.objective}\n\n` +
    (artifact ? `## Summary\n${artifact.summary}\n\n## Decisions\n${artifact.decisions.map(x => '- ' + x).join('\n') || '- None confirmed.'}\n\n## Actions (review owners)\n${artifact.actions.map(x => '- ' + x).join('\n') || '- None confirmed.'}\n\n## Open questions\n${artifact.questions.map(x => '- ' + x).join('\n')}\n\n` : '') +
    `## Transcript\n${transcript.filter(t => t.final).map(t => `- [${formatTime(t.at)}] **${t.speaker}:** ${t.text}`).join('\n')}\n\n## Insights\n${sortInsights(insights).map(i => `### ${i.category}: ${i.title}\n${i.question ? `Question: ${i.question}\n\n` : ''}${i.body}\n\n${i.detail}\n\n_Source: ${i.provenance}; transcript ${i.triggerId}_\n${i.citations.map(c => `- ${c.title}: ${c.url}`).join('\n')}`).join('\n\n')}\n`;
}
