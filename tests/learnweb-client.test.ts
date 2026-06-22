import assert from 'node:assert/strict';
import test from 'node:test';

import { LearnwebClient } from '../src/learnweb-core/client';
import type { LearnwebSession } from '../src/learnweb-core/session';
import type { Activity } from '../src/shared/domain';

const BASE_URL = 'https://learnweb.example';

test('Opencast-Legacy-Scan überspringt fehlerhafte Detailseiten und setzt den Scan fort', async () => {
  const failedId = '11111111-1111-1111-1111-111111111111';
  const resolvedId = '22222222-2222-2222-2222-222222222222';
  const calls: string[] = [];
  const session = {
    getBaseUrl: () => BASE_URL,
    get: async (path: string) => {
      calls.push(path);
      if (path.endsWith(`&e=${failedId}`)) throw new Error('Timeout');
      if (path.endsWith(`&e=${resolvedId}`)) {
        return {
          status: 200,
          data: String.raw`<script>amd.init({"url":"https:\/\/video.example\/resolved.mp4"});</script>`,
          headers: {},
          url: `${BASE_URL}${path}`,
        };
      }
      return {
        status: 200,
        data: `
          <a href="/mod/opencast/view.php?id=42&amp;e=${failedId}">Defekt</a>
          <a href="/mod/opencast/view.php?id=42&amp;e=${resolvedId}">Vorlesung 2</a>`,
        headers: {},
        url: `${BASE_URL}${path}`,
      };
    },
  } as unknown as LearnwebSession;
  const activity: Activity = {
    cmid: 42,
    courseId: 7,
    modtype: 'opencast',
    name: 'eLectures',
    sectionName: 'Vorlesungen',
    sectionIndex: 1,
    viewUrl: null,
    isSelected: true,
    status: 'selected',
    lastSeenAt: null,
  };

  const candidates = await new LearnwebClient(session).resolveRecordingCandidates(activity);

  assert.deepEqual(calls, [
    '/mod/opencast/view.php?id=42',
    `/mod/opencast/view.php?id=42&e=${failedId}`,
    `/mod/opencast/view.php?id=42&e=${resolvedId}`,
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.recordingKey, resolvedId);
  assert.equal(candidates[0]?.title, 'Vorlesung 2');
  assert.equal(candidates[0]?.mediaUrl, 'https://video.example/resolved.mp4');
  assert.equal(candidates[0]?.needsAuth, true);
});
