#!/usr/bin/env node
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

if (!webhookUrl) {
  console.error('DISCORD_WEBHOOK_URL is required.');
  process.exit(1);
}

const title = process.env.ALERT_TITLE || 'Home server alert';
const details = process.env.ALERT_DETAILS || '';
const severity = process.env.ALERT_SEVERITY || 'warning';
const status = process.env.ALERT_STATUS || 'firing';
const service = process.env.ALERT_SERVICE || 'home-server';
const hostname = process.env.ALERT_HOSTNAME || '';

const emoji = status === 'ok' ? '✅' : severity === 'critical' ? '🚨' : '⚠️';
const content = [`${emoji} **${title}**`, `Status: ${status}`, `Severity: ${severity}`, `Service: ${service}`];

if (hostname) content.push(`Host: ${hostname}`);
if (details) content.push('', details.slice(0, 1800));

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    content: content.join('\n'),
    allowed_mentions: { parse: [] },
  }),
});

if (!response.ok) {
  const body = await response.text().catch(() => '');
  console.error(`Discord webhook failed with ${response.status}: ${body}`);
  process.exit(1);
}
