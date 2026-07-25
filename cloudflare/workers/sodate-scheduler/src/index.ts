export interface Env {
  GH_PAT: string;
}

const REPO = 'dailyhotcoolmeme/sodate';

// GitHub 자체 schedule 트리거가 원인불명으로 몇 시간씩 안 도는 사고(2026-07-25) 대응용.
// Cloudflare cron이 event.cron에 매칭된 크론 표현식 문자열을 그대로 넘겨준다.
const CRON_TARGETS: Record<string, string> = {
  '*/15 * * * *': 'refresh-soldout.yml',
  '*/20 * * * *': 'watchdog.yml',
  '0 23 * * *': 'crawl.yml',  // 08:00 KST — crawl.yml 자체 스케줄과 동일 시각(백업용, concurrency로 중복실행 방지)
  '0 11 * * *': 'crawl.yml',  // 20:00 KST
};

async function dispatch(workflow: string, ghPat: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghPat}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'sodate-scheduler-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  console.log(`dispatch ${workflow}: ${res.status}`);
  if (!res.ok) {
    console.error(`dispatch ${workflow} failed: ${await res.text()}`);
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const workflow = CRON_TARGETS[event.cron];
    if (!workflow) {
      console.error(`알 수 없는 cron: ${event.cron}`);
      return;
    }
    ctx.waitUntil(dispatch(workflow, env.GH_PAT));
  },

  async fetch(): Promise<Response> {
    return new Response('sodate-scheduler: cron worker, HTTP 핸들러 없음', { status: 200 });
  },
};
