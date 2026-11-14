import type { Artifact, Insight, Transcript } from './shared';
type Moment = { speaker: string; text: string; cards: Array<Pick<Insight, 'category' | 'title' | 'body' | 'detail'> & { priority?: Insight['priority']; question?: string }> };
export const moments: Moment[] = [
  { speaker: 'Maya · Engineering lead', text: 'Let’s settle the event delivery design today. We need checkout events in the analytics pipeline, and product is asking for a p99 under 200 milliseconds.', cards: [
    { category: 'background', title: 'p99 is a tail-latency measure', body: 'A p99 of 200 ms means 99% of measured requests finish within 200 ms. It does not describe the slowest request.', detail: 'Useful follow-up: define the measurement window, workload, and the start/end points before treating this as an SLO.' },
    { category: 'question', title: 'Where does the latency budget start?', body: '“Is the 200 ms target from checkout commit to event ingestion, or all the way to a queryable dashboard?”', detail: 'These boundaries produce very different architectures. Ask before choosing a broker or committing to the target.' },
  ] },
  { speaker: 'Daniel · Backend engineer', text: 'I propose we write to Postgres and then publish to the broker. With retries, that should give us exactly-once delivery end to end.', cards: [
    { category: 'risk', title: 'Two writes leave a failure window', body: 'If the database commit succeeds but publishing fails, an event can disappear. A retry can also publish a duplicate.', detail: 'Assumption to test: there is no existing transactional boundary between Postgres and the broker. A transactional outbox can address the dual-write gap.', priority: 'high' },
    { category: 'evidence', title: '“Exactly once” needs a defined scope', body: 'Retries alone do not establish exactly-once effects. Check the broker guarantee, consumer behavior, and external side effects.', detail: 'Demo reference: the Kafka documentation discusses delivery semantics and the limits of coordination with external systems. Read the source before applying the claim.' },
  ] },
  { speaker: 'Priya · Platform engineer', text: 'Could we use a transactional outbox and make consumers idempotent? We already have a stable checkout ID that we could use as a deduplication key.', cards: [
    { category: 'solution', question: 'Could we use a transactional outbox and make consumers idempotent?', title: 'Commit the event with checkout, then relay it', body: 'Yes. Write checkout data and an outbox event in one transaction, then relay with retries. Make the consumer deduplicate the event ID alongside its business update.', detail: 'Why it helps: an atomic outbox write removes the gap between committing checkout and recording the event. A relay can retry delivery without blocking checkout.\n\nImplementation: use one database transaction for checkout and outbox; keep the original event ID on every delivery; atomically record processed IDs with consumer updates.\n\nTradeoffs: the relay adds operational work and delivery latency. Deduplication retention must cover the replay window. This is a possible approach, not an agreed production design.', priority: 'high' },
    { category: 'terminology', title: 'Use “idempotent consumer” precisely', body: 'Repeated delivery of the same logical event should have the same business effect as a single delivery.', detail: 'Try: “We can accept at-least-once delivery if each consumer makes repeated processing safe.” Distinct events must still have distinct identities.' },
  ] },
  { speaker: 'Maya · Engineering lead', text: 'That sounds promising. What happens when analytics is down for an hour? I don’t want a retry storm to take checkout down with it.', cards: [
    { category: 'answer', question: 'What happens when analytics is down for an hour?', title: 'Queue the backlog and keep checkout running', body: 'Let events accumulate in the outbox while analytics is unavailable. Retry with bounded concurrency and backoff; after recovery, drain the backlog at a controlled rate.', detail: 'Keep checkout independent: commit checkout and the event locally, and let the relay handle analytics delivery asynchronously.\n\nDuring the outage: cap relay concurrency, use exponential backoff with jitter, and monitor oldest-event age, backlog size, and available storage.\n\nAfter recovery: reserve throughput for new events while draining older ones. The exact recovery time depends on arrival rate, spare consumer capacity, and storage; the meeting has not established those numbers. This answer assumes the proposed outbox design is adopted.', priority: 'high' },
    { category: 'question', title: 'What is the recovery objective?', body: '“After a one-hour outage, how quickly must we drain the backlog while keeping new events within their latency target?”', detail: 'This exposes throughput headroom and recovery expectations that the steady-state p99 target does not cover.' },
  ] },
  { speaker: 'Daniel · Backend engineer', text: 'We can move poison events to a dead-letter queue after five attempts, then replay them once the schema issue is fixed.', cards: [
    { category: 'background', title: 'A dead-letter queue is a holding area', body: 'A DLQ isolates events that cannot be processed successfully so they can be inspected and handled separately.', detail: 'It does not fix the failure. A replay procedure needs an owner, access controls, observability, and a defined policy for sensitive payloads.' },
    { category: 'risk', title: 'Replay can invalidate deduplication assumptions', body: 'If deduplication keys expire before a replay, an old event may produce its business effect again.', detail: 'Ask whether replay preserves the original event ID and how deduplication retention relates to the maximum replay window.' },
  ] },
  { speaker: 'Priya · Platform engineer', text: 'We should preserve event IDs on replay. Also, I think an outbox polling interval of 500 milliseconds will still keep the end-to-end p99 under 200 milliseconds.', cards: [
    { category: 'risk', title: 'The polling cadence conflicts with the target', body: 'A 500 ms polling interval can consume more than the entire 200 ms budget before broker or consumer work begins.', detail: 'Under uniformly arriving events, polling introduces variable waiting time up to approximately one interval. Real scheduling and load add further variance.', priority: 'high' },
    { category: 'question', title: 'Benchmark the complete path', body: '“Can we measure commit → relay → broker → consumer latency under peak load before choosing polling versus change-data capture?”', detail: 'Keep the two approaches as hypotheses until a representative workload establishes their latency and operational costs.' },
  ] },
  { speaker: 'Maya · Engineering lead', text: 'Agreed: let’s prototype the outbox with idempotent consumers. Daniel, compare polling with change-data capture by Thursday. Priya, document the replay and deduplication policy. We have not committed to the 200 millisecond target yet.', cards: [
    { category: 'insight', title: 'A decision, two actions, one open target', body: 'Prototype the outbox approach. Daniel owns the relay comparison; Priya owns the replay policy. The latency commitment remains open.', detail: 'These assignments are explicit in this fictional discussion. The summary will preserve the distinction between a prototype decision and a production commitment.', priority: 'high' },
  ] },
];
export function demoMoment(index: number): { item: Transcript; cards: Insight[] } {
  const m = moments[index]; const id = `demo-${index}`;
  const number = [...new Set(moments.map(m => m.speaker))].indexOf(m.speaker) + 1;
  return { item: { id, speakerId: `demo-speaker-${number}`, speakerNumber: number, speaker: `Speaker ${number}`, text: m.text, at: index * 18, final: true }, cards: m.cards.map((c, i) => ({
    ...c, id: `${id}-card-${i}`, priority: c.priority || 'normal', detail: c.detail, triggerId: id, at: index * 18, provenance: 'demo',
    citations: c.category === 'evidence' ? [{ title: 'Apache Kafka · Delivery semantics', url: 'https://kafka.apache.org/documentation/#semantics' }] : [],
  })) };
}
export function demoArtifact(count: number): Artifact {
  return { summary: count >= 7 ? 'The team agreed to prototype a transactional outbox with idempotent consumers. Relay latency and replay safety require validation before a production commitment.' :
    'The team is reviewing event delivery guarantees and a proposed 200 ms p99 latency target. The discussion is still in progress; later demo decisions are not included.',
    decisions: count >= 7 ? ['Prototype an outbox with idempotent consumers. The 200 ms latency target is not yet committed.'] : [],
    actions: count >= 7 ? ['Daniel: compare polling with change-data capture by Thursday (date not specified).', 'Priya: document replay and deduplication policy (deadline not specified).'] : [],
    questions: ['What are the exact boundaries and measurement window of the latency SLO?', ...(count >= 4 ? ['How quickly must an outage backlog drain?'] : []), ...(count >= 5 ? ['How long must replay IDs remain deduplicated?'] : [])] };
}
