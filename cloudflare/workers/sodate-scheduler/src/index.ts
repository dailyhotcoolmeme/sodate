export interface Env {
  GH_PAT: string;
}

const REPO = 'dailyhotcoolmeme/sodate';

// GitHub 자체 schedule 트리거가 원인불명으로 몇 시간씩 안 도는 사고(2026-07-25) 대응용.
// Cloudflare cron이 event.cron에 매칭된 크론 표현식 문자열을 그대로 넘겨준다.
// crawl.yml의 20시(evening) 슬롯은 slot='evening' 입력을 같이 넘겨야 마감알림 스텝이
// 정상 실행됨(안 넘기면 crawl.yml이 "임시 재시도"로 간주해 마감알림을 스킵 — 중복발송 방지용).
interface Target {
  workflow: string;
  inputs?: Record<string, string>;
}
const CRON_TARGETS: Record<string, Target> = {
  // 백업 트리거도 스케줄과 같은 '임박 2일내' 경량 작업을 시키려면 days 를 넘겨야 한다.
  // 안 넘기면 워크플로가 전체 미래를 도는 무거운 쪽으로 빠진다(2026-07-31 정정).
  '*/10 * * * *': { workflow: 'refresh-soldout.yml', inputs: { days: '2' } },
  '*/20 * * * *': { workflow: 'watchdog.yml' },
  // 비imweb 임박분도 백업 트리거를 건다 — 임박 마감이 실제 신청에 직결된다.
  // 워크플로 크론과 같은 시각(2,17,32,47)으로 맞춰 중복 큐를 만들지 않는다.
  '2,17,32,47 * * * *': { workflow: 'refresh-nonimweb.yml', inputs: { days: '2' } },
  '0 23 * * *': { workflow: 'crawl.yml', inputs: { slot: 'morning' } },  // 08:00 KST
  '0 11 * * *': { workflow: 'crawl.yml', inputs: { slot: 'evening' } },  // 20:00 KST
};

async function dispatch(target: Target, ghPat: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${target.workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghPat}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'sodate-scheduler-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: target.inputs ?? {} }),
    }
  );
  console.log(`dispatch ${target.workflow}: ${res.status}`);
  if (!res.ok) {
    console.error(`dispatch ${target.workflow} failed: ${await res.text()}`);
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const target = CRON_TARGETS[event.cron];
    if (!target) {
      console.error(`알 수 없는 cron: ${event.cron}`);
      return;
    }
    ctx.waitUntil(dispatch(target, env.GH_PAT));
  },

  async fetch(): Promise<Response> {
    return new Response('sodate-scheduler: cron worker, HTTP 핸들러 없음', { status: 200 });
  },
};
