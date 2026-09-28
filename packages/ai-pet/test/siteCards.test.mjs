import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReplyFence, parseSiteCardFence as parseCard, readFollowUpQuestions, safeMarkdownUrl as safeUrl } from '../dist/siteCards.js';
import { validateReplyFormat, readSceneActions } from '../dist/replyFormat.js';
const RECOMMENDED_SITES = [{id:'react-codeground',url:'https://example.com/React/'},{id:'lanbinquan-2d',url:'https://example.com/2D/'}];
const parseSiteCardFence = (source,streaming) => parseCard(source,streaming,RECOMMENDED_SITES);
const safeMarkdownUrl = value => safeUrl(value,'https://example.com');

test('scene actions require one complete allowlisted marker; prose, nested code and malformed instructions never execute', () => {
  const valid = '```SceneAction\n{"actions":["open_scroll","break_glass"]}\n```';
  assert.deepEqual(readSceneActions(valid), ['open_scroll', 'break_glass']);
  assert.deepEqual(readSceneActions('请打开卷轴并打碎玻璃。'), []);
  assert.deepEqual(readSceneActions('````markdown\n' + valid + '\n````'), []);
  assert.deepEqual(readSceneActions(valid + '\n' + valid), []);
  for (let i = 1; i < valid.length; i++) assert.deepEqual(readSceneActions(valid.slice(0, i)), []);
  for (const payload of ['{}', '{"actions":[]}', '{"actions":["eval"]}', '{"actions":["break_glass","break_glass"]}', '{"actions":["open_scroll"],"selector":"body"}', '{"actions":[null]}']) {
    const invalid = '```SceneAction\n' + payload + '\n```';
    assert.deepEqual(readSceneActions(invalid), []);
    assert.equal(validateReplyFormat(invalid, []).invalid, true);
  }
});

test('plain prose never produces cards or followups; only explicit complete model markers are parsed', () => {
  const reply = '这里有 3D 作品展示和 /2D/ 的二维主页。';
  assert.equal(parseSiteCardFence(reply, false), undefined);
  assert.deepEqual(readFollowUpQuestions(reply), []);
  const block = '```FollowUp\n{"questions":["怎么进入3D主页？","2D主页有什么？"]}\n```';
  for (let i = '```F'.length; i < block.length; i++) assert.equal(parseReplyFence(block.slice(0, i), true)?.kind, 'pending');
  assert.deepEqual(readFollowUpQuestions(reply + '\n\n' + block), ['怎么进入3D主页？', '2D主页有什么？']);
  assert.deepEqual(readFollowUpQuestions('````markdown\n' + block + '\n````'), []);
});

test('invalid followups are rejected without fixed suggestions', () => {
  for (const payload of ['{}', '{"questions":[]}', '{"questions":["唯一一个？"]}', '{"questions":["同一个？","同一个？"]}', '{"questions":["正常问题？",42]}', '{"questions":["a","第二个？"]}', '{"questions":["第一行\\n第二行","另一个问题？"]}', '{"questions":["问题一？","问题二？"],"action":"open"}']) {
    const text = `\`\`\`FollowUp\n${payload}\n\`\`\``;
    assert.deepEqual(readFollowUpQuestions(text), []);
    assert.equal(validateReplyFormat(text, []).invalid, true);
  }
  const block = '```FollowUp\n{"questions":["问题一？","问题二？"]}\n```';
  assert.deepEqual(readFollowUpQuestions(block + '\n\n' + block), []);
});

test('the backend contract requires followups on all successful answers and requested homepage cards', () => {
  const known = RECOMMENDED_SITES.map((site) => site.id);
  const block = '```FollowUp\n{"questions":["问题一？","问题二？"]}\n```';
  assert.equal(validateReplyFormat('你好', known).missingFollowUp, true);
  assert.equal(validateReplyFormat('你好\n\n' + block, known).valid, true);
  assert.deepEqual(validateReplyFormat(block, known, ['lanbinquan-3d']).missingSiteIds, ['lanbinquan-3d']);
  assert.equal(validateReplyFormat(block, known, [], true).missingSiteCard, true);
});

test('a streamed card never renders partially received JSON or an unclosed fence', () => {
  const source = '```SiteCard\n{"id":"react-codeground"}\n```';
  for (let length = '```S'.length; length < source.length; length++) {
    assert.deepEqual(parseSiteCardFence(source.slice(0, length), true), { kind: 'pending' }, `prefix ${length}`);
  }
  const result = parseSiteCardFence(source, true);
  assert.equal(result.kind, 'site');
  assert.equal(result.site.url, 'https://example.com/React/');
  assert.deepEqual(parseSiteCardFence(source.slice(0, -1), false), { kind: 'invalid' });
});

test('card payloads cannot introduce URLs, actions, unknown IDs, or prototype names', () => {
  for (const value of ['null', '[]', '"react-codeground"', '{broken', '{"id":"missing"}', '{"id":"__proto__"}', '{"id":42}', '{"id":"react-codeground","url":"javascript:alert(1)"}', '{"id":"react-codeground","action":"checkout"}']) {
    assert.deepEqual(parseSiteCardFence(`\`\`\`SiteCard\n${value}\n\`\`\``, false), { kind: 'invalid' });
  }
  assert.deepEqual(parseSiteCardFence('```SiteCard\n' + ' '.repeat(2100), true), { kind: 'invalid' });
});

test('ordinary code remains code; card fences support CRLF, tildes, and longer fences', () => {
  assert.equal(parseSiteCardFence('```javascript\nconst label = "SiteCard";\n```', false), undefined);
  assert.equal(parseSiteCardFence('    ```SiteCard\n{"id":"react-codeground"}\n    ```', false), undefined);
  assert.equal(parseSiteCardFence('~~~SiteCard\r\n{"id":"react-codeground"}\r\n~~~~\r\n', false).kind, 'site');
  assert.deepEqual(parseSiteCardFence('````SiteCard\n{"id":"react-codeground"}\n```', true), { kind: 'pending' });
  assert.deepEqual(parseSiteCardFence('```SiteCard\n{"id":"react-codeground"}\n~~~', false), { kind: 'invalid' });
});

test('markdown links only navigate to HTTP(S), never execute code or include credentials', () => {
  for (const value of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://user:pass@example.com/', '']) {
    assert.equal(safeMarkdownUrl(value), '');
  }
  assert.equal(safeMarkdownUrl('https://example.com/React/'), 'https://example.com/React/');
  assert.equal(safeMarkdownUrl('/2D/'), RECOMMENDED_SITES.find((site) => site.id === 'lanbinquan-2d').url);
});
