import assert from 'node:assert/strict';

// Stateful substitutes for the Heritage reservation service and both Discord webhooks.
export function cardFlowFixture(onPost) {
  const cards = new Map(), events = new Map(), messages = new Map();
  const guildId = '703456789012345678';
  const fetch = (url, method, body) => {
    if (url.hostname === 'discord.com') {
      const webhookId = url.pathname.split('/')[3];
      const channelId = url.pathname.includes('/alerts') ? '713456789012345678' : '723456789012345678';
      const message = url.pathname.includes('/messages/') ? url.pathname.split('/').at(-1) : null;
      if (method === 'GET' && !message) return Response.json({ id:webhookId, channel_id:channelId, guild_id:guildId });
      if (method === 'GET') return Response.json(messages.get(message));
      const id = message || String(423456789012345678n + BigInt(messages.size));
      if (method === 'PATCH') {
        assert.ok(messages.has(id)); assert.equal(body.content, ''); assert.deepEqual(body.allowed_mentions.parse, []);
      } else onPost(url.pathname, body);
      const data = { ...body, id, webhook_id:webhookId, channel_id:url.searchParams.get('thread_id') || channelId };
      messages.set(id, data);
      return Response.json(data);
    }
    if (url.hostname !== 'fixture.invalid' || !body.action?.includes('card')) return null;
    if (body.action === 'reserve-card') {
      if (events.has(body.key)) return Response.json(events.get(body.key));
      const card = cards.get(body.cardKey);
      if (body.operation === 'resolve' && (!card || card.openLineage !== body.lineage)) return Response.json({state:'skipped'});
      events.set(body.key, body);
      return Response.json({ state:'reserved', reservation:'f'.repeat(64), messageId:card?.rootId, existing:Boolean(card),
        preserveWarning:body.operation === 'private' && Boolean(card?.openLineage) });
    }
    const event = events.get(body.key), card = cards.get(event.cardKey) || {};
    if (body.action === 'ensure-card-thread') return Response.json({ threadId:card.rootId });
    assert.equal(body.action, 'complete-card');
    assert.equal(body.outcome, 'sent');
    const reply = event.operation === 'reply', existing = Boolean(card.rootId);
    const preserveWarning = event.operation === 'private' && Boolean(card.openLineage);
    if (!reply) {
      card.rootId = body.messageId;
      if (event.operation === 'warn') card.openLineage = event.lineage;
      if (event.operation === 'resolve') delete card.openLineage;
      cards.set(event.cardKey, card);
    }
    const receipt = { state:'sent', messageId:body.messageId, rootId:card.rootId, guildId,
      channelId:reply ? card.rootId : event.channelId, existing, preserveWarning };
    events.set(body.key, receipt);
    return Response.json(receipt);
  };
  return { fetch, messages };
}
