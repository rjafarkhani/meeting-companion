import type { Insight, SpeakerProfiles, Transcript } from './shared';

export function speakerId(line: Transcript, profiles: SpeakerProfiles = {}): string {
  return resolveSpeaker(line.speakerId || line.speaker, profiles);
}
export function resolveSpeaker(id: string, profiles: SpeakerProfiles): string {
  const seen = new Set<string>();
  while (profiles[id]?.aliasOf && !seen.has(id)) { seen.add(id); id = profiles[id].aliasOf!; }
  return id;
}
export function namedTranscript(lines: Transcript[], profiles: SpeakerProfiles): Transcript[] {
  // Preserve the provider identity/number separately from editable display names.
  const defaults = new Map(lines.map(t => [t.speakerId || t.speaker, t.speaker]));
  return lines.map(t => {
    const id = speakerId(t, profiles), profile = profiles[id];
    const name = profile?.name.trim() || defaults.get(id) || t.speaker;
    return { ...t, speakerId: id, speaker: name + (profile?.isMe ? ' (you)' : '') };
  });
}
export function meetingSpeakers(lines: Transcript[], profiles: SpeakerProfiles) {
  const result = new Map<string, { id: string; name: string; isMe: boolean; count: number }>();
  for (const t of namedTranscript(lines.filter(t => t.final), profiles)) {
    const id = t.speakerId!, old = result.get(id);
    result.set(id, { id, name: t.speaker, isMe: !!profiles[id]?.isMe, count: (old?.count || 0) + 1 });
  }
  return [...result.values()];
}
export function relatedInsights(insights: Insight[], lines: Transcript[], profiles: SpeakerProfiles, selected: string | null) {
  if (selected === '*') return insights;
  const ids = new Set(lines.filter(t => t.final && speakerId(t, profiles) === selected).map(t => t.id));
  return insights.filter(i => ids.has(i.triggerId));
}
export function upsertTranscript(previous: Transcript[], items: Transcript[], replaceIds: string[] = []) {
  const incoming = new Map(items.map(t => [t.id, t]));
  const removed = new Set(replaceIds);
  return [...previous.filter(t => !removed.has(t.id)).map(t => {
    const item = incoming.get(t.id); incoming.delete(t.id); return item || t;
  }), ...incoming.values()];
}
