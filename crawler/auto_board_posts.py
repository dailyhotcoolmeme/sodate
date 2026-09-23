"""모잇 커뮤니티 자동 글 초안 생성기.

기존 게시판의 실제 말투를 참고해 자동 게시 후보를 만들고 auto_board_posts에 저장한다.
이 스크립트는 board_posts에 직접 쓰지 않는다. 공개는 예약 게시 작업만 수행한다.

실행:
  python auto_board_posts.py --count 12                 # 토큰 없는 로컬 조합 생성
  python auto_board_posts.py --count 3 --dry-run
  python auto_board_posts.py --generator cloudflare --count 3  # 수동 Cloudflare Workers AI 생성
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import time
from collections import Counter
from dataclasses import dataclass

import httpx

from utils.supabase_client import get_supabase


CF_ACCOUNT_ID = os.getenv('CF_ACCOUNT_ID', '4c0f5d706177b84ade4d424a08ec46e8')
CF_MODEL = os.getenv('AUTO_BOARD_AI_MODEL', '@cf/meta/llama-4-scout-17b-16e-instruct')
CF_AI_URL = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}'
CF_AI_PROVIDER = 'cloudflare-workers-ai'

CASUAL_NICKNAMES = [
    'ㅇㅇ', 'ㅋㅋ', '궁금', '오잉', '퇴근하고싶다', '주말뭐하지', '아무거나',
    '그냥궁금', '오늘도출근', '집가고싶음', '소심이', '연애어렵다', '밥뭐먹지',
    '익명', '흠흠', 'ㄹㅇ', '모르겠다', '고민중', '지나가던사람', '두근두근',
    '직장인1', '주말순삭', '커피수혈', '배고픔', '잠이안옴', '월요일싫다',
]

# 앱 최초 진입 시 자동 배정되는 닉네임과 동일한 조합 풀
# (app/lib/reviewIdentity.ts). 일반 익명형과 절반씩 섞어 자동 글만 따로
# 보이지 않게 한다.
AUTO_NICK_ADJ = [
    '느긋한', '설레는', '포근한', '다정한', '씩씩한', '엉뚱한', '새침한', '발랄한', '든든한', '나른한',
    '상냥한', '명랑한', '수줍은', '활기찬', '차분한', '사랑스런', '귀여운', '온화한', '따뜻한', '재빠른',
    '폭신한', '몽글한', '초롱한', '야무진', '싱그런', '보드란', '깜찍한', '해맑은', '느릿한', '반짝이는',
]
AUTO_NICK_NOUN = [
    '너구리', '수달', '다람쥐', '고슴도치', '알파카', '펍귄', '여우', '토끼', '햄스터', '판다',
    '코알라', '물개', '오리', '참새', '고양이', '강아지', '병아리', '고래', '거북이', '사슴',
    '붕어빵', '마카롱', '복숭아', '딸기', '감자', '도넛', '푸딩', '참외', '귤', '만두', '곰젤리', '떡',
    '구름', '별', '방울', '풍선', '단추', '도토리', '조약돌', '램프', '솜사탕', '우산',
]

AVATAR_IDS = [f'thumbs_{i:02d}' for i in range(1, 25)]

BANNED = (
    '씨발', '시발', '개새끼', '병신', '지랄', '좆', '보지', '자지', '창녀',
    '성매매', '조건만남', '카톡아이디', '오픈채팅', '주식추천', '코인추천', '존나',
)

TOPIC_MIX = """
- 소개팅·첫 만남·애프터 고민 35%
- 썸·연애·연락 문제 25%
- 로테이션 소개팅·소셜링 경험과 질문 20%
- 취미·데이트·콘텐츠·생활 등 시간에 영향받지 않는 2030 일상 15%
- 가벼운 밸런스게임·유행 소재 5%
""".strip()

TOPICS = ['소개팅', '썸연애', '로테이션소개팅', '2030일상', '밸런스게임']
POST_KINDS = ['review', 'advice', 'question', 'casual', 'companion']
KIND_LABELS = {
    'review': '리얼후기',
    'advice': '고민상담',
    'question': '궁금해요',
    'companion': '동행구함',
}

# 익명 게시판에서는 내용이 후기나 질문이어도 말머리를 생략하는 경우가 더 많다.
# 종류별 확률을 적용하되 한 생성 묶음에서 전체 25%를 넘지 않게 한 번 더 제한한다.
TAG_PROBABILITIES = {
    'review': 0.28,
    'advice': 0.20,
    'question': 0.15,
    'casual': 0.0,
    'companion': 0.40,
}

# 모델이 맥락 없는 상황을 억지로 만들지 않게, 실제 커뮤니티에서 답하기 쉬운 소재만 준다.
# 문장과 결론은 모델이 새로 만들고, 이 목록은 소재 방향만 잡는다.
SCENARIOS_BY_KIND = {
    'review': [
        '첫 로테이션 소개팅에 혼자 다녀온 느낌',
        '소개팅에서 카페 후 자연스럽게 2차까지 간 후기',
        '소셜링에서 처음 본 사람들과 대화해 본 후기',
        '매칭 후 첫 연락을 주고받은 후기',
        '애프터에서 식사하고 산책한 가벼운 후기',
        '소개팅 약속 전 연락을 적게 했는데 만나니 괜찮았던 후기',
        '취미가 안 겹쳐도 대화가 잘 됐던 소개팅 후기',
        '혼술바에 혼자 가서 옆자리 사람과 가볍게 대화한 후기',
        '소개팅에서 존댓말을 놓고 편해진 후기',
        '로테이션 소개팅에서 짧게 여러 사람과 대화한 후기',
        '소개팅에 옷을 조금 과하게 입었지만 대화는 편했던 후기',
        '소개팅 비용을 자연스럽게 나눠 낸 후기',
        '애프터 메뉴를 고민하다 가벼운 식사로 잘 끝낸 후기',
        '소개팅 동안 서로 폰을 안 봐서 대화가 편했던 후기',
        '소개팅 사진과 실제 인상은 달랐지만 만나니 더 괜찮았던 후기',
        '친구 소개로 만난 사람과 초반은 어색했지만 점점 편해진 후기',
        '소셜링에서 같은 취미를 가진 사람과 대화가 잘 된 후기',
        '혼술바 분위기가 생각보다 편해서 오래 머문 후기',
        '로테이션 소개팅에서 첫 대화보다 뒤쪽 대화가 편해진 후기',
        '소개팅 후 애프터 연락을 먼저 보냈는데 반응이 좋았던 후기',
    ],
    'advice': [
        '대화는 잘 되는데 상대가 질문을 안 하는 상황',
        '소개팅 후 먼저 연락할지 기다릴지',
        '카톡 답장 속도 차이가 큰 썸',
        '연애 초반 연락 빈도',
        '친구가 소개해준 사람과 잘 안 됐을 때',
        '데이트 중 휴대폰을 자주 보는 상대',
        '데이트 장소를 한쪽만 계속 정하는 상황',
        '장거리 썸을 시작해도 될지',
        '연락은 잘 되는데 약속을 안 잡는 상팀',
        '썸 단계에서 생일 선물을 챙기는지',
    ],
    'question': [
        '첫 소개팅에서 2차를 누가 먼저 제안하는지',
        '소개팅 전 연락을 얼마나 자주 하는지',
        '첫 만남 옷을 너무 꾸미면 부담스러운지',
        '첫 만남 비용을 어떻게 나누는지',
        '애프터 식당 메뉴로 무엇이 무난한지',
        '로테이션 소개팅 첫 참가 전 준비할 것',
        '매칭 후 첫 연락을 뭐라고 시작할지',
        '소개팅에서 술을 마시는 게 좋은지',
        '첫 만남에서 존댓말을 언제 놓는지',
        '소개팅에서 대화가 잠깐 끊기면 어떤 주제로 넘기는지',
    ],
    'casual': [
        '혼자 전시나 팝업을 보러 가는 것',
        '친구들과 연애 얘기를 어디까지 공유하는지',
        '자주 먹는 간단한 간식',
        '카페에서 하루 내내 노트북 하는 사람 얘기',
        '재미있게 본 영화나 드라마 얘기',
        '플레이리스트에서 자주 듣는 노래 얘기',
        '집에서 가장 오래 사용하는 물건 얘기',
        '배달 메뉴 하나만 계속 시키는 습관',
        '사진을 찍을 때 기본 카메라와 앱 중 뭘 쓰는지',
        '읽다가 끝까지 못 읽은 책 얘기',
        '여행 갈 때 계획을 세우는 편인지 즉흥으로 가는지',
        '옷을 살 때 온라인과 매장 중 어디를 선호하는지',
        '휴대폰 배경화면을 자주 바꾸는지',
        '집 정리를 시작하면 어디부터 손대는지',
        '이어폰을 자주 잃어버리는 사람 얘기',
        '하나에 빠지면 같은 콘텐츠만 반복해서 보는 습관',
        '친구 추천으로 시작했다가 빠진 취미',
        '사진첩을 정리하다가 예전 사진을 계속 보게 되는 얘기',
    ],
    'companion': [
        '전시를 같이 볼 동행을 구하는 글',
        '로테이션 소개팅에 혼자 가기 어색해 동행을 구하는 글',
        '팝업스토어에 같이 갈 사람을 구하는 글',
        '산책이나 카페에 같이 갈 사람을 구하는 글',
        '가볍게 식사할 사람을 구하는 글',
        '처음 가는 소셜링에 같이 신청할 사람을 구하는 글',
        '가벼운 러닝을 같이 할 사람을 구하는 글',
        '새로 개봉한 영화를 같이 볼 사람을 구하는 글',
    ],
}

SYSTEM_PROMPT = """당신은 한국의 20~30대 익명 커뮤니티에 올라갈 짧은 게시글 초안을 만든다.
광고문·블로그·상담 답변처럼 반듯하게 쓰지 말고 실제 익명 게시판 이용자처럼 쓴다.
출력은 반드시 요청한 JSON 스키마만 지킨다."""

# 매일 자동 실행은 아래 검수된 조합만 사용한다. 외부 AI를 호출하지 않으므로 토큰 비용이 0이다.
# 각 사례는 (제목 표현 2개, 본문 3줄, 주제) 순서다. 제목 표현과 말끝을 조합해 최근 글과
# 같은 제목이 나오지 않게 하고, 생성 뒤에는 AI 결과와 동일한 _valid 검사를 다시 거친다.
LOCAL_REVIEW_CASES = [
    (('로소 혼자 가본', '혼자 로소 가본'), '로소 혼자 가봤는데 시작 전엔 좀 어색할줄 알았음', '막상 자리 들어가니까 진행 따라가면 돼서 생각보다 편했어', '몇 번 대화하고 나니까 긴장도 금방 풀리더라', '로테이션소개팅'),
    (('로소 대화 여러 번 해본', '로테이션 소개팅 대화해본'), '로소 가서 짧게 여러 명이랑 얘기해봤어', '첫 대화는 좀 뚝뚝했는데 뒤로 갈수록 말이 잘나오더라', '한 명이랑 길게 얘기하는 거보다 부담은 덜했음', '로테이션소개팅'),
    (('소셜링 혼자 가본', '혼자 소셜링 가본'), '소셜링 혼자 가봤는데 아는 사람 하나도 없었음', '처음만 살짝 어색하고 주제 나오니까 다들 금방 얘기하더라', '혼자 갈까말까 고민한 게 아까울 정도였어', '로테이션소개팅'),
    (('소셜링에서 취미 얘기한', '취미 소셜링 가본'), '소셜링에서 취미 얘기했는데 생각보다 대화가 잘됐어', '좋아하는 게 완전 같진 않아도 서로 물어볼 게 많더라', '대화 끊길 걱정했는데 괜히 했음 ㅋㅋ', '로테이션소개팅'),
    (('혼술바 혼자 가본', '혼자 혼술바 가본'), '혼술바 혼자 가봤는데 생각보다 부담 없었어', '가볍게 마시다가 옆자리랑 자연스럽게 얘기하게 됐음', '혼자 있어도 눈치 안보여서 괜찮더라', '로테이션소개팅'),
    (('혼술바에서 대화해본', '혼술바 분위기 겪어본'), '혼술바에서 처음 본 사람이랑 얘기해봤어', '시끄럽게 노는 분위기일줄 알았는데 대화하기 편한 쪽이더라', '가볍게 있다 오기엔 생각보다 괜찮았음', '로테이션소개팅'),
    (('소개팅 비용 나눠낸', '소개팅 반반 내본'), '소개팅 끝나고 계산할 때 살짝 애매할줄 알았거든', '상대가 자연스럽게 나눠 내자고 해서 나도 바로 냈어', '괜히 눈치게임 안해서 오히려 편했음', '소개팅'),
    (('소개팅 존댓말 놓아본', '소개팅에서 말 편하게 해본'), '소개팅 초반엔 계속 존댓말해서 대화가 좀 딱딱했어', '서로 말 편하게 하자고 하고 나니까 분위기가 확 풀리더라', '타이밍만 자연스러우면 괜찮은듯', '소개팅'),
    (('소개팅 사진이랑 달랐던', '소개팅 첫인상 달랐던'), '소개팅 사진이랑 실제 인상이 좀 달랐어', '근데 얘기해보니까 사진보다 훨씬 편하고 웃겼음', '첫인상만 보고 판단하면 안되겠더라', '소개팅'),
    (('소개팅 대화 안끊긴', '소개팅에서 얘기 잘통한'), '소개팅 전에 취미가 안겹쳐서 걱정했어', '막상 만나니까 서로 모르는 거 물어보다가 얘기가 계속 이어지더라', '취미 같아야 대화되는 건 아닌듯', '소개팅'),
    (('소개팅 때 폰 안본', '소개팅 대화에 집중해본'), '소개팅하면서 둘 다 폰을 거의 안봤어', '별거 아닌데 상대가 대화에 집중하는 느낌이라 좋더라', '나도 괜히 더 편하게 얘기하게 됐음', '소개팅'),
    (('소개팅 옷 좀 꾸며입은', '소개팅 옷차림 신경쓴'), '소개팅이라 평소보다 옷을 좀 신경써서 입었어', '혼자 너무 꾸몄나 싶었는데 상대도 비슷하게 입고 왔더라', '깔끔하게만 입으면 크게 부담 없는듯', '소개팅'),
    (('소개팅 전 연락 적게한', '연락 적게하고 소개팅한'), '소개팅 약속 잡고 연락을 많이 안했어', '만나기 전에 할말 다 떨어질까봐 필요한 얘기만 했거든', '막상 만나서는 얘기할 게 많아서 오히려 괜찮았음', '소개팅'),
    (('애프터 먼저 보내본', '소개팅 뒤 먼저 연락한'), '소개팅 끝나고 내가 먼저 애프터 연락 보냈어', '괜히 부담스러워할까 고민했는데 답장도 빨리 오더라', '마음 있으면 먼저 보내도 별문제 없는듯', '소개팅'),
    (('애프터 메뉴 가볍게 먹은', '애프터 식사 편하게 한'), '애프터 메뉴 고민하다가 그냥 가볍게 먹었어', '비싼 곳보다 얘기 편하게 할 수 있는 데가 더 낫더라', '메뉴 걱정 많이 했는데 분위기가 더 중요한듯', '소개팅'),
    (('애프터 산책해본', '애프터로 걷고온'), '애프터에서 카페 갔다가 조금 걸었어', '마주 보고 얘기할 때보다 걸으면서 말하니까 덜 어색하더라', '길게 계획 안짜도 충분히 괜찮았음', '소개팅'),
    (('매칭 뒤 첫 연락 해본', '매칭 상대랑 연락 시작한'), '매칭되고 첫 연락 뭐라할지 한참 고민했어', '인사만 보내고 프로필에 있던 취미 하나 물어봤거든', '거창하게 시작 안해도 대화는 이어지더라', '소개팅'),
    (('친구 소개로 만나본', '친구가 소개해준 사람 만난'), '친구 소개라 괜히 더 어색할줄 알았어', '처음엔 둘 다 말 없었는데 공통 친구 얘기 나오니까 좀 편해지더라', '소개받는 것도 생각보다 나쁘지 않았음', '소개팅'),
    (('로소 자리 이동 겪어본', '로소 진행 따라가본'), '로소에서 자리 계속 바꾸며 대화해봤어', '정신없을줄 알았는데 시간이 정해져 있으니까 오히려 집중되더라', '안맞는 대화도 금방 넘어가서 편했음', '로테이션소개팅'),
    (('소셜링 첫인사 해본', '소셜링에서 먼저 말걸어본'), '소셜링에서 먼저 말거는 게 제일 어렵더라', '옆에 있는 사람한테 주제 어땠냐고 물으니까 바로 얘기 이어졌어', '첫마디만 넘기면 생각보다 별거 아니었음', '로테이션소개팅'),
]

LOCAL_ADVICE_CASES = [
    (('상대가 질문을 안함', '나만 계속 질문하는 소개팅'), '소개팅에서 상대가 대답은 잘하는데 질문을 하나도 안함', '나만 계속 물어보는 느낌인데 관심 없는 걸까?', '소개팅'),
    (('소개팅 뒤 먼저 연락', '애프터 연락 먼저 보내기'), '소개팅 분위기는 나쁘지 않았는데 상대 연락을 기다리는 중임', '그냥 내가 먼저 잘 들어갔냐고 보내도 됨?', '소개팅'),
    (('카톡 답장 속도 차이', '썸 답장 텀이 너무 다름'), '썸 연락할 때 답장 속도가 들쭉날쭉함', '대화는 잘되는데 텀이 길면 그냥 바쁜 걸로 봐도 되나?', '썸연애'),
    (('연애 초반 연락 빈도', '사귀고 연락 얼마나 함'), '연애 시작했는데 연락 빈도를 아직 못맞췄어', '계속 붙잡고 얘기하는 건 부담일까?', '썸연애'),
    (('친구 소개 잘 안됐을때', '소개받은 사람과 애매해짐'), '친구가 소개해준 사람이랑 몇 번 연락했는데 잘 안맞는 느낌임', '소개해준 친구한테 어느 정도까지 말하는 게 나음?', '소개팅'),
    (('데이트 중 폰 보는 상대', '만나서 폰만 보는 사람'), '같이 있을 때 상대가 폰을 자주 봄', '한두 번은 괜찮은데 계속 그러면 말해도 되겠지?', '썸연애'),
    (('데이트 장소 나만 정함', '약속 장소 계속 내가 고름'), '만날 때마다 장소를 내가 정하고 있어', '상대는 다 좋다고만 하는데 이거 관심 차이임?', '썸연애'),
    (('장거리 썸 시작 고민', '멀리 사는 사람이랑 썸'), '대화는 잘통하는데 거리가 꽤 멀어', '시작하기도 전에 거리부터 걱정하는 게 맞나?', '썸연애'),
    (('연락은 되는데 약속 안잡음', '대화만 하고 안만나는 썸'), '연락은 계속 오는데 만나자는 얘기는 안나옴', '내가 먼저 약속 잡아볼지 그냥 더 봐야할지 고민됨', '썸연애'),
    (('썸 생일선물 고민', '썸 단계 선물 어디까지'), '아직 사귀는 건 아닌데 생일을 알게 됐어', '부담 없는 거라도 챙기는 게 나음?', '썸연애'),
    (('소개팅 대화가 자꾸 끊김', '소개팅 침묵 너무 길었음'), '소개팅에서 대화가 몇 번씩 뚝 끊겼어', '어색한 침묵 생기면 보통 무슨 얘기로 넘김?', '소개팅'),
    (('호감 표현 어디까지', '썸한테 티내는 정도'), '상대한테 마음 있는 건 맞는데 너무 티내면 부담일까봐 애매함', '먼저 보고싶다고 말해도 괜찮나?', '썸연애'),
]

LOCAL_QUESTION_CASES = [
    (('소개팅 2차 누가 먼저 말함', '2차 제안 먼저 해도 됨'), '소개팅에서 얘기 잘통하면 내가 먼저 2차 가자고 해도 됨?', '소개팅'),
    (('소개팅 전 연락 얼마나 함', '만나기 전 연락 빈도'), '소개팅 약속 잡은 뒤엔 연락 어느 정도 하는 게 무난함?', '소개팅'),
    (('첫 만남 옷 얼마나 꾸밈', '소개팅 옷차림 궁금'), '첫 만남에 너무 꾸민 느낌이면 오히려 부담스러움?', '소개팅'),
    (('소개팅 비용 보통 어케 냄', '첫 만남 계산 방식'), '소개팅 비용은 한 명이 내고 다음에 번갈아 내는 편임 아니면 바로 나눔?', '소개팅'),
    (('애프터 메뉴 추천좀', '애프터 식사 뭐가 무난함'), '애프터에서 먹기 편하고 대화 끊기지 않는 메뉴 뭐가 나음?', '소개팅'),
    (('로소 처음 갈때 준비', '로테이션 소개팅 준비물'), '로소 처음 가는데 미리 생각해둘 질문 같은 거 있음?', '로테이션소개팅'),
    (('매칭 뒤 첫마디 뭐라함', '첫 연락 시작 멘트'), '매칭되고 처음 연락할 때 인사 다음에 뭐라고 하는 게 자연스러움?', '소개팅'),
    (('소개팅에서 술 마심?', '첫 만남 술 괜찮음'), '소개팅에서 가볍게 술 마시는 거 호불호 큼?', '소개팅'),
    (('존댓말 언제 놓음', '첫 만남 말 편하게 하는 타이밍'), '첫 만남에서 말 편하게 하자는 얘기 누가 먼저 꺼내는 편임?', '소개팅'),
    (('소개팅 대화 주제 추천', '대화 끊길때 무슨 얘기함'), '소개팅에서 대화 잠깐 끊기면 꺼내기 좋은 주제 뭐있음?', '소개팅'),
    (('소셜링 혼자 가도 됨', '혼자 소셜링 가본 사람'), '소셜링 아는 사람 없이 혼자 가도 금방 섞일 수 있음?', '로테이션소개팅'),
    (('로소 한 사람당 대화 시간', '로소 대화 짧지 않음?'), '로소는 한 사람하고 얘기하는 시간이 짧아도 느낌이 옴?', '로테이션소개팅'),
]

LOCAL_CASUAL_CASES = [
    (('전시 혼자 보는거', '혼자 전시 가는 사람'), '혼자 전시 보면 내 속도로 볼 수 있어서 편하긴 함', '근데 감상 얘기할 사람이 없는 건 좀 아쉽더라'),
    (('연애얘기 어디까지 공유함', '친구한테 연애얘기 얼마나 함'), '친구들이랑 연애얘기 다 공유하는 편임?', '나는 중요한 것만 말하는데 진짜 하나부터 열까지 말하는 사람도 있더라'),
    (('간식 하나만 추천좀', '자주 먹는 간식 뭐임'), '과자 말고 가볍게 집어먹을 거 찾는 중', '한 번 사두면 계속 먹는 간식 있으면 추천좀'),
    (('카페서 노트북 오래 하는 사람', '카페에서 작업 잘되는 사람'), '카페 가면 집중 잘된다는 사람 신기함', '나는 사람 구경하다가 끝나는데 다들 진짜 일 됨?'),
    (('재밌게 본 영화 추천', '끝까지 본 드라마 추천좀'), '한 번 시작하면 계속 보게 되는 거 찾고 있음', '장르 상관없이 몰입 잘되는 거 하나만 추천좀'),
    (('플레이리스트 몇 곡임', '노래 하나 꽂히면 반복함?'), '노래 하나 마음에 들면 질릴 때까지 그것만 듣는 편임', '플레이리스트 자주 갈아엎는 사람도 많나?'),
    (('집에서 제일 오래 쓰는 물건', '은근 잘산 물건 있음?'), '큰맘 먹고 산 것보다 별생각 없이 산 걸 더 오래 쓰는듯', '가격 안비싼데 잘샀다 싶은 거 뭐있음?'),
    (('배달 메뉴 맨날 같은거', '새 메뉴 도전 잘함?'), '배달앱 켜도 결국 먹던 것만 고르게 됨', '새로운 거 시켰다가 실패하는 게 더 싫어 ㅋㅋ'),
    (('사진 기본카메라로 찍음?', '사진 앱 따로 쓰는 사람'), '사진 찍을 때 기본카메라만 쓰는데 앱 쓰면 차이 큼?', '보정 귀찮아서 찍고 그대로 두는 편임'),
    (('끝까지 못읽은 책', '책 사놓고 안읽는 사람'), '표지는 마음에 들어서 샀는데 앞부분만 읽고 멈춘 책이 쌓임', '책은 사는 거랑 읽는 게 완전 다른 취미인듯'),
    (('여행 계획 세세하게 짬?', '여행 즉흥으로 가는 사람'), '여행 가면 갈 곳 다 정해두는 편이랑 가서 정하는 편 갈리더라', '나는 큰 것만 잡고 나머진 그냥 돌아다니는 게 편함'),
    (('옷 온라인으로 잘삼?', '옷은 매장 가서 입어봄?'), '온라인이 편하긴 한데 사진이랑 핏 다를 때가 많음', '귀찮아도 입어보고 사는 게 실패는 적은듯'),
    (('배경화면 자주 바꿈?', '휴대폰 배경 뭐해둠'), '배경화면 한 번 해두면 몇 년씩 그대로 쓰는 편임', '자주 바꾸는 사람들은 사진 어디서 찾는지 궁금함'),
    (('집 정리 어디부터 함', '정리 시작하면 더 어질러짐'), '정리하려고 물건 다 꺼냈다가 더 난장판 됐어', '버릴 거 고르는 데서부터 막히는 사람 나뿐임?'),
    (('이어폰 자꾸 사라짐', '작은 물건 잘 잃어버림?'), '이어폰 한쪽이나 충전선 같은 작은 것만 자꾸 없어짐', '정해둔 자리에 놓는 습관이 진짜 되긴 함?'),
    (('같은 콘텐츠 반복해서 봄?', '재밌는거 또보는 사람'), '새로운 거 찾기 귀찮으면 봤던 거 또 틀게 됨', '내용 다 아는데도 편해서 계속 보게 되더라'),
    (('친구 추천으로 시작한 취미', '생각없이 시작했다가 빠진거'), '친구 따라 한 번 해본 건데 내가 더 열심히 하게 된 적 있음?', '취미는 이렇게 얼떨결에 생기는 게 오래가는듯'),
    (('사진첩 정리 가능함?', '사진 삭제 잘하는 사람'), '사진 정리하려고 열었다가 하나씩 구경만 하고 끝남', '비슷한 사진도 못지우겠는데 다들 바로바로 정리함?'),
]

LOCAL_COMPANION_CASES = [
    (('전시 같이 볼 사람', '전시 동행 구함'), '전시 혼자 보는 것도 괜찮은데 끝나고 감상 얘기할 사람이 있으면 좋겠음', '관심 있는 사람 있으면 같이 보고 카페 정도 가자'),
    (('로소 같이 신청할 사람', '로테이션 소개팅 동행 구함'), '로소 처음이라 혼자 신청하기 살짝 어색함', '각자 참여하더라도 들어갈 때 같이 갈 사람 있음?'),
    (('팝업 같이 갈 사람', '팝업 동행 구함'), '구경하고 싶은 팝업 있는데 혼자 가긴 좀 심심함', '사진도 서로 찍어주고 가볍게 보고 올 사람 구함'),
    (('카페 같이 갈 사람', '카페 동행 구함'), '혼자 카페 가는 것도 질려서 가볍게 얘기할 사람 있으면 좋겠음', '부담 없이 커피 마시고 각자 가는 정도면 됨'),
    (('가볍게 밥먹을 사람', '식사 동행 구함'), '혼자 먹기 애매한 메뉴 먹고 싶은데 같이 갈 사람 있음?', '길게 놀기보다 밥만 편하게 먹는 정도 생각중'),
    (('소셜링 같이 신청할 사람', '처음 소셜링 동행'), '소셜링 관심 있는데 혼자 신청 버튼 누르기가 애매함', '같이 신청하고 현장에선 각자 편하게 놀 사람 구함'),
    (('러닝 같이 할 사람', '가볍게 뛸 사람 구함'), '기록 욕심 없이 천천히 뛰는 정도로 시작하려고 함', '혼자 하면 자꾸 미뤄서 같이 꾸준히 할 사람 있나?'),
    (('영화 같이 볼 사람', '영화 동행 구함'), '보고 싶은 영화 있는데 혼자 보기엔 살짝 심심함', '영화 보고 감상 조금 얘기하고 헤어질 사람 구함'),
]

# 다섯 건 중 한 건가량은 읽을 만한 분량이 되도록 별도로 검수한 긴 글 풀이다.
# 시각·날씨에 기대지 않고, 짧은 글을 억지로 반복해 늘리지 않은 독립 본문만 둔다.
LOCAL_LONG_CASES = {
    'review': [
        (('로소 혼자 끝까지 해본', '혼자 간 로소 자세한 느낌'),
         '로소 혼자 신청하고 가기 전까지 괜히 취소할까 몇 번 생각했음\n입구에서 혼자 기다릴 때가 제일 어색했고 막상 시작하니까 진행 따라가느라 정신 없더라\n\n처음 두 명이랑은 무슨 말 했는지도 잘 기억 안날 정도로 긴장했는데\n세 번째부터는 자주 묻는 질문도 생기고 내 얘기도 좀 편하게 했어\n짧게 얘기해서 아쉽다 싶은 사람도 있었고 반대로 빨리 끝나서 다행인 자리도 있었음\n\n끝나고 나니 혼자 간 건 아무도 신경 안쓰더라\n처음 가는 거면 시작 전 어색함만 버티면 생각보다 할만했어',
         '로테이션소개팅'),
        (('소개팅 대화 풀린 과정', '어색하다 편해진 소개팅'),
         '소개팅 자리 앉았을 때 서로 긴장해서 대답만 짧게 오갔어\n이대로 끝나는 건가 싶어서 메뉴 얘기부터 그냥 편하게 꺼냈음\n\n상대가 먹는 거 좋아한다고 해서 자주 가는 곳 얘기하다가 여행이랑 취미까지 넘어갔고\n그때부터는 누가 질문하는지도 모르게 대화가 계속 이어지더라\n처음 인상만 보면 둘 다 조용한 사람인줄 알았는데 웃는 포인트도 비슷했어\n\n처음 몇 분 어색했다고 바로 안맞는다고 생각할 필요는 없는듯\n조금 풀리고 나서 보이는 분위기가 따로 있더라',
         '소개팅'),
        (('애프터 먼저 보낸 자세한 후기', '먼저 애프터 잡아본 얘기'),
         '소개팅 끝나고 분위기는 괜찮았는데 상대가 먼저 연락할지 확신은 없었어\n괜히 기다리면서 의미부여할 것 같아서 내가 먼저 잘 들어갔냐고 보냈음\n\n답장 오고 나서는 만났을 때 했던 얘기 이어서 조금 주고받았고\n다시 보고 싶다고 너무 돌려 말하지 않고 편하게 말했어\n상대도 좋다고 해서 메뉴랑 장소만 가볍게 정했음\n\n먼저 보내면 마음이 더 커 보일까 걱정했는데 막상 별일 아니더라\n괜찮았던 사람한테는 눈치게임보다 표현하는 게 나은듯',
         '소개팅'),
        (('소셜링 혼자 적응한 과정', '낯가리는 사람 소셜링 후기'),
         '낯가리는 편인데 소셜링을 혼자 가봤어\n이미 친해 보이는 사람들이 있으면 어쩌나 걱정했는데 대부분 처음 온 사람들이더라\n\n처음엔 옆사람이랑 인사만 하고 조용히 있었는데 진행자가 주제를 던져주니까 말할 게 생겼음\n한 사람이 자기 얘기 꺼내면 비슷한 경험 있는 사람들이 붙어서 대화가 이어졌고\n나도 듣다가 공감되는 부분에 한마디씩 하니까 금방 섞였어\n\n사교성 좋아야만 가는 자리는 아니었음\n말 많이 안해도 흐름 따라가다 보면 편해지더라',
         '로테이션소개팅'),
        (('혼술바 혼자 앉아본 과정', '혼자 간 혼술바 긴 후기'),
         '혼술바는 혼자 가도 된다고 해도 들어가기 전엔 꽤 어색했어\n일단 한 잔 시키고 혼자 메뉴 보면서 앉아 있었음\n\n옆자리 사람이 메뉴 뭐가 괜찮냐고 물어서 짧게 대답했는데 그게 대화 시작이 됐어\n서로 왜 혼자 왔는지부터 좋아하는 술 얘기까지 자연스럽게 이어졌고\n계속 떠들어야 하는 분위기도 아니라 중간에 조용히 있어도 부담 없더라\n\n무조건 누군가 만나야 한다는 생각 없이 가면 괜찮은듯\n혼자 있어도 되고 대화가 생기면 그것도 재밌었어',
         '로테이션소개팅'),
        (('사진보다 대화가 중요했던 소개팅', '첫인상 뒤집힌 소개팅 얘기'),
         '소개팅 사진만 봤을 때는 내 취향이랑 조금 다르다고 생각했어\n약속은 잡았으니 편하게 얘기나 해보자는 마음으로 나갔음\n\n실제로 만나니 표정이랑 말투가 사진에서 느낀 인상이랑 완전 달랐고\n내 얘기에 반응도 잘해주고 본인 얘기도 솔직하게 해서 대화가 편했어\n취미는 많이 안겹쳤는데 서로 모르는 걸 물어보는 재미가 있더라\n\n사진 한두 장으로 사람 느낌을 정해두는 게 별 의미 없다는 생각 들었음\n직접 대화해봐야 아는 부분이 훨씬 큰듯',
         '소개팅'),
    ],
    'advice': [
        (('소개팅 뒤 연락 흐름이 애매함', '연락은 오는데 관심인지 모르겠음'),
         '소개팅에서는 대화도 잘됐고 헤어질 때도 분위기 괜찮았어\n상대가 먼저 잘 들어갔냐고 연락해서 나도 느낌 좋다고 생각했음\n\n근데 그 뒤로 연락은 계속 오는데 답장이 길지는 않고 질문도 거의 없어\n내가 하나 물으면 답하고 다른 얘기로 넘어가는 식이라 대화를 나만 끌고 가는 느낌임\n그렇다고 끊으려 하면 또 먼저 가벼운 얘기를 보내기는 해\n\n그냥 연락 스타일이 이런 건지 관심은 없는데 예의로 이어가는 건지 모르겠어\n한 번 더 만나자고 직접 물어보는 게 제일 확실할까?',
         '소개팅'),
        (('데이트 약속을 나만 잡는 느낌', '만날 장소 계속 나만 정함'),
         '썸 타는 사람이랑 몇 번 만났는데 약속 정할 때마다 내가 먼저 얘기함\n상대는 만나자고 하면 좋다고 하고 실제로 만나면 분위기도 괜찮아\n\n근데 날짜부터 장소랑 메뉴까지 거의 내가 후보를 보내야 정해져\n뭐 하고 싶은지 물어봐도 아무거나 좋다고만 하니까 점점 힘 빠짐\n연락 자체는 먼저 올 때도 있어서 아예 관심 없는 것 같지는 않거든\n\n원래 계획 안세우는 성격이면 이 정도는 받아들여야 하나\n한 번 솔직하게 번갈아 정하자고 말해도 됨?',
         '썸연애'),
        (('답장 텀 차이 때문에 헷갈림', '연락 속도 다른 썸 고민'),
         '연락 시작한 사람인데 대화할 때는 말도 잘통하고 답장 내용도 성의 있어\n근데 답 오는 간격이 짧을 때도 있고 한참 비어 있을 때도 있음\n\n바쁘다고 미리 말한 적은 있는데 텀이 길어지면 괜히 내가 말실수했나 생각하게 돼\n연락 횟수로 마음 판단하면 안된다는 건 아는데 아직 관계가 애매해서 더 신경쓰임\n내가 답장을 빨리 하는 편이라 체감 차이가 큰 걸 수도 있어\n\n이런 건 좀 더 만나보면서 보는 게 맞나\n연락 스타일을 대놓고 물어보면 너무 이른 느낌임?',
         '썸연애'),
        (('소개팅에서 침묵이 길었음', '대화 끊긴 소개팅 다시 볼지'),
         '소개팅 상대가 나쁜 사람은 아니었고 말할 때는 편했어\n근데 둘 다 먼저 주제를 잘 꺼내는 편이 아니라 중간마다 침묵이 길게 생겼음\n\n조용해질 때마다 내가 질문을 찾느라 머리가 바빠서 상대 얘기에 집중도 잘 안되더라\n상대도 비슷하게 긴장한 것 같긴 했고 헤어질 때는 다음에 보자는 말도 했어\n첫 만남이라 그런 건지 원래 대화 결이 안맞는 건지 판단이 안됨\n\n외적인 호감은 있어서 한 번 더 보면 달라질까 싶어\n이 정도 어색함이면 다시 만나보는 편임?',
         '소개팅'),
        (('썸인데 호감 표현을 못하겠음', '좋아하는 티 어디까지 냄'),
         '몇 번 만난 사람한테 호감은 있는데 내가 표현을 잘 못하는 편임\n상대가 먼저 만나자고도 하고 연락도 이어가는데 나도 좋다는 티를 내고 싶어\n\n막상 메시지 쓰면 너무 진지해 보일까봐 지우고 결국 평범한 답만 보내게 됨\n만나서는 잘 웃고 대화도 하는데 집에 가면 내가 관심 없어 보였을까 걱정돼\n부담 주는 고백을 하려는 건 아니고 다음에도 보고 싶다는 정도만 전하고 싶음\n\n그냥 헤어진 뒤에 재밌었다고 먼저 말하는 것부터 하면 되나\n자연스럽게 호감 표현하는 방법 뭐가 있음?',
         '썸연애'),
        (('친구 소개가 애매하게 끝남', '소개해준 친구한테 뭐라함'),
         '친구가 연결해준 사람이랑 연락하고 한 번 만났는데 서로 크게 끌리지는 않은 것 같아\n대화가 불편한 건 아니었지만 다시 약속 잡을 정도의 느낌도 없었음\n\n상대랑은 부담 없이 여기까지 하자는 식으로 얘기가 된 상태야\n문제는 소개해준 친구가 계속 어땠냐고 물어보고 잘됐으면 하는 기대가 커 보여\n상대 얘기를 자세히 평가하는 건 예의 아닌 것 같고 그렇다고 얼버무리기도 애매함\n\n서로 좋은 사람이지만 인연은 아닌 것 같다고만 말하면 충분하겠지\n이럴 때 소개해준 사람한테 보통 어디까지 말함?',
         '소개팅'),
    ],
    'question': [
        (('소개팅 전 연락 기준 궁금', '만나기 전 카톡 어느 정도 함'),
         '소개팅 약속은 잡았는데 만나기 전까지 연락을 얼마나 해야 할지 매번 애매함\n계속 얘기하면 실제로 만났을 때 할말이 줄어들 것 같고\n아예 필요한 얘기만 하면 관심 없어 보일까봐 신경쓰여\n\n가벼운 일상 얘기 정도는 이어가는 편인지\n장소랑 일정만 확인하고 만나는 편인지 사람마다 진짜 다르더라\n다들 소개팅 전에는 카톡 어느 정도 함?',
         '소개팅'),
        (('첫 만남 비용 나누는 방식', '소개팅 계산할 때 보통 어케함'),
         '첫 만남 계산할 때 한 사람이 먼저 내면 다음 장소는 다른 사람이 내는 방식이 편하긴 하잖아\n근데 애프터가 없을 수도 있으니까 바로 나누는 게 깔끔하다는 얘기도 이해됨\n\n상대가 계산대로 가면 옆에서 바로 나눠 내겠다고 말하는지\n일단 두고 다음 카페에서 자연스럽게 내는지 궁금함\n괜히 계산 순간에 실랑이하는 것도 더 어색한 것 같아\n보통 어떤 방식이 제일 무난했음?',
         '소개팅'),
        (('로소 짧은 대화로 판단 가능함?', '로테이션 대화 시간 궁금'),
         '로소는 여러 명을 만나는 대신 한 사람과 얘기하는 시간이 짧다고 들었어\n처음엔 누구나 긴장할 텐데 그 안에 서로 느낌을 알 수 있는지 궁금함\n\n질문 몇 개 하다 보면 바로 자리 바꿀 것 같고\n말이 천천히 풀리는 사람은 조금 불리할 수도 있을 것 같거든\n그래도 여러 사람을 비교해서 볼 수 있다는 건 괜찮아 보임\n가본 사람들은 짧아도 호감 가는 사람이 구분됐음?',
         '로테이션소개팅'),
        (('애프터 메뉴 고르는 기준', '두 번째 만남 음식 뭐가 편함'),
         '애프터 약속 잡을 때 첫 만남보다 메뉴가 더 고민되는 것 같아\n너무 가벼우면 성의 없어 보일까 싶고 비싼 곳은 서로 부담될 수 있잖아\n\n먹기 불편한 음식은 대화가 끊기고\n조용한 곳만 찾으면 선택지가 확 줄어들더라\n상대가 딱히 못먹는 건 없다고 해서 더 고르기 어려움\n다들 두 번째 만남에는 어떤 메뉴가 제일 편했음?',
         '소개팅'),
    ],
    'casual': [
        (('취미가 오래 안가는 이유', '시작한 취미 자꾸 접게 됨'),
         '뭔가 배워보고 싶어서 찾아볼 때는 엄청 재밌어 보이는데\n막상 장비 사고 몇 번 해보면 처음만큼 손이 안가더라\n\n실력이 빨리 안늘어서 그런가 싶다가도 잘해야만 취미인가 싶고\n혼자 하는 건 미루게 돼서 모임을 들어가면 오히려 부담될 때도 있음\n그래도 완전히 그만두면 산 물건이 아까워서 한 번씩 다시 꺼내봄\n\n꾸준히 하는 사람들은 재미 떨어지는 구간을 그냥 넘기는 건가\n오래 붙잡고 있는 취미 하나 있는 사람 좀 신기함'),
        (('친구들이랑 취향 달라진 느낌', '친구랑 노는 방식이 달라짐'),
         '오래 본 친구들이랑 사이가 안좋은 건 아닌데 만나서 하고 싶은 게 점점 달라지는 것 같아\n누구는 계속 새로운 곳 찾아다니고 싶어하고 누구는 익숙한 데서 얘기만 하는 걸 좋아함\n\n예전에는 아무거나 해도 재밌었는데 각자 취향이 확실해지니까 약속 하나 잡는 것도 오래 걸려\n그렇다고 취향 맞는 사람만 새로 만나는 건 또 다른 얘기고\n결국 중간 지점 찾다가 늘 비슷한 선택으로 끝남\n\n친한 거랑 같이 놀기 편한 건 조금 다른 문제인듯\n다들 오래된 친구랑 취향 달라지면 어떻게 맞춤?'),
        (('사진첩 정리하다 포기함', '사진을 못지우는 이유'),
         '사진이 너무 쌓여서 정리하려고 열었는데 삭제보다 구경을 더 오래 했어\n비슷하게 찍은 사진도 표정이 조금씩 달라서 하나만 고르기가 어렵더라\n\n스크린샷은 나중에 볼 것 같아서 남겨두고\n음식 사진은 왜 찍었는지 모르겠는데 지우려니 또 애매함\n정리 앱도 써봤는데 마지막에 내가 확인해야 하니까 결국 똑같았어\n\n용량 부족 알림 뜰 때만 잠깐 지우고 다시 쌓이는 중임\n사진 바로 정리하는 사람들은 찍고 곧바로 고르는 건가?'),
        (('온라인 쇼핑 실패 줄이는 법', '옷 사진이랑 핏 너무 다름'),
         '온라인으로 옷 보면 모델 사진은 괜찮은데 내가 입으면 느낌이 다른 경우가 많아\n사이즈표 재고 후기까지 다 읽어도 원단이나 핏은 직접 보기 전엔 모르겠더라\n\n반품 귀찮아서 그냥 입은 옷도 있는데 결국 손이 잘 안감\n매장 가면 입어볼 수는 있지만 선택지가 적고 돌아다니는 것도 꽤 힘들어\n편한 건 온라인인데 성공률은 매장이 더 높은 느낌임\n\n후기 사진 많은 것만 고르는 게 그나마 답인가\n온라인으로 옷 잘사는 사람은 뭘 제일 먼저 봄?'),
        (('콘텐츠 고르다 끝나는 사람', '볼거 찾는 데 더 오래 걸림'),
         '뭐 하나 보려고 목록 열면 선택지가 너무 많아서 예고편만 계속 넘기게 됨\n평점 찾아보고 후기 조금 읽다 보면 이미 흥미가 떨어져 있어\n\n결국 전에 봤던 거 다시 틀거나 짧은 영상만 보다 끝나는 경우가 많음\n새 작품은 초반에 집중해야 하는 게 은근 부담인 것 같아\n재밌다는 추천을 받아도 저장만 하고 시작은 잘 안하게 됨\n\n취향에 딱 맞는 걸 찾으려다 아무것도 못보는 느낌임\n그냥 첫 화면에 뜨는 거 바로 보는 사람이 오히려 잘 즐기는듯'),
        (('물건 정리 기준이 어려움', '안쓰는 물건 못버리겠음'),
         '정리하려고 꺼내보면 안쓰는 물건인데도 하나씩 이유가 생겨\n언젠가 필요할 것 같거나 선물 받은 거라 미안하거나 다시 살 수도 있다는 생각이 듦\n\n그러다 보니 버리는 건 몇 개 없고 꺼낸 것만 다시 넣게 돼\n수납함을 사면 잠깐 깔끔해지는데 물건 총량은 그대로라 금방 또 차더라\n진짜 필요한 것만 남기라는 말은 쉬운데 그 기준 잡는 게 제일 어려움\n\n오래 안쓴 건 바로 정리하는 규칙이라도 만들어야 하나\n미련 없이 버리는 사람들은 판단을 어떻게 함?'),
    ],
}

LOCAL_TITLE_WRAPPERS = {
    'review': ['{base} 후기', '{base} 얘기', '{base} 솔직 느낌', '{base} 생각보다 괜찮았음', '{base} 은근 괜찮더라'],
    'advice': ['{base}', '{base} 이거 어케함?', '{base} 나만 고민됨?', '{base} 조언좀', '{base} 어떻게 생각함?'],
    'question': ['{base}', '{base} 궁금', '{base} 보통 어케함?', '{base} 다들 어떰?', '{base} 뭐가 나음?'],
    'casual': ['{base}', '{base} 얘기', '{base} 나만 이럼?', '{base} 은근 갈림', '{base} 다들 어떰?'],
    'companion': ['{base}', '{base} 있나?', '{base} 편하게 갈사람', '{base} 같이 가자'],
}


@dataclass
class Draft:
    title: str
    content: str
    topic: str
    kind: str = 'question'
    scenario: str = ''
    is_long: bool = False


def _plain(value: str) -> str:
    value = re.sub(r'<br\s*/?>', '\n', value or '', flags=re.I)
    value = re.sub(r'</(?:p|li|div|ol|ul)>', '\n', value, flags=re.I)
    value = re.sub(r'<[^>]+>', '', value)
    return html.unescape(value).strip()


def _key(value: str) -> str:
    return re.sub(r'[^0-9a-z가-힣]', '', value.lower())


def _recent_samples(sb) -> list[dict[str, str]]:
    rows = (
        sb.table('board_posts')
        .select('title,content')
        .eq('is_active', True)
        .eq('is_notice', False)
        .order('created_at', desc=True)
        .limit(80)
        .execute().data or []
    )
    samples: list[dict[str, str]] = []
    for row in rows:
        title = _plain(row.get('title') or '')
        content = _plain(row.get('content') or '')
        if not title or not content:
            continue
        samples.append({'title': title[:80], 'content': content[:500]})
    return samples


def _existing_auto_titles(sb) -> set[str]:
    try:
        rows = (
            sb.table('auto_board_posts')
            .select('title')
            .order('created_at', desc=True)
            .limit(500)
            .execute().data or []
        )
    except Exception:
        return set()
    return {_key(r.get('title') or '') for r in rows}


def _kind_plan(count: int) -> list[str]:
    """한 번에 3건을 만들 때 질문만 나열되지 않게 후기 1건을 보장한다."""
    if count == 3:
        kinds = ['review', random.choice(['advice', 'question']), random.choice(['casual', 'companion'])]
    elif count == 2:
        kinds = ['review', random.choice(['advice', 'question', 'casual', 'companion'])]
    else:
        kinds = [random.choices(POST_KINDS, weights=[30, 20, 20, 20, 10], k=1)[0]]
    random.shuffle(kinds)
    return kinds


def _kind_targets(count: int) -> list[str]:
    """전체 생성 건수를 3건씩 나눠 후기·질문·일상 비율을 끝까지 지킨다."""
    targets: list[str] = []
    full_batches, remainder = divmod(count, 3)
    for batch_index in range(full_batches):
        batch = [
            'review',
            'advice' if batch_index % 2 == 0 else 'question',
            'companion' if batch_index % 5 == 4 else 'casual',
        ]
        random.shuffle(batch)
        targets.extend(batch)
    if remainder:
        targets.extend(_kind_plan(remainder))
    return targets


def _generation_requests(kinds: list[str]) -> list[tuple[str, str]]:
    """같은 종류 안에서도 소재가 겹치지 않게 먼저 전체 계획을 짠다."""
    pools = {kind: random.sample(items, len(items)) for kind, items in SCENARIOS_BY_KIND.items()}
    positions: Counter[str] = Counter()
    requests: list[tuple[str, str]] = []
    for kind in kinds:
        position = positions[kind]
        if position and position % len(pools[kind]) == 0:
            random.shuffle(pools[kind])
        requests.append((kind, pools[kind][position % len(pools[kind])]))
        positions[kind] += 1
    return requests


def _prompt(samples: list[dict[str, str]], requests: list[tuple[str, str]]) -> str:
    count = len(requests)
    compact = '\n'.join(
        f"- 제목: {s['title']}\n  내용: {s['content']}"
        for s in samples[:24]
    )
    seeds = '\n'.join(f'- {i + 1}번·{kind}: {scenario}' for i, (kind, scenario) in enumerate(requests))
    return f"""아래는 현재 모잇 익명 게시판의 실제 글이다. 문장을 복사하지 말고 말투와 길이만 참고해 새 글 {count}개를 만들어라.

[실제 게시글 말투 참고]
{compact}

[주제 비율]
{TOPIC_MIX}

[이번에 사용할 소재]
아래 소재와 글 종류를 하나씩만 사용한다. 여기에 없는 사건·장소·직업·성별·나이 설정을 임의로 붙이지 않는다.
{seeds}
- 반드시 1번부터 순서대로 쓰고, 각 번호의 소재 핵심이 제목이나 본문에 드러나야 한다.
- 소재에 로테이션 소개팅이 없으면 `로소`나 `로테이션`으로 바꿔 쓰지 않는다.

[글 종류·말머리]
- review: 질문이 아니라 자신이 겪은 일을 자연스럽게 풀어쓴 후기. 끝을 굳이 질문으로 마치지 않는다.
- advice: 상황을 풀어놓고 조언을 구하는 글.
- question: 가벼운 궁금증을 묻는 글.
- companion: 같이 갈 사람을 구하는 글. 연락처는 적지 않는다.
- casual: 일상 잡담. 말머리를 붙이지 않는다.
- 시스템이 일부 글에만 내용과 맞는 말머리를 별도로 붙인다. 글 종류와 관계없이 제목·본문만 자연스럽게 쓴다.
- 제목과 본문에 [리얼후기], [고민상담] 같은 말머리 문자를 직접 적지 않는다.

[반드시 지킬 말투]
- 짧게 끊고 말하듯 쓴다. 대부분은 2~6문장으로 쓰되 전체의 약 20%는 상황과 생각이 이어지는 6~9문장 분량으로 쓴다.
- 긴 글도 블로그처럼 정리하지 말고, 실제 익명 게시판에서 사정을 조금 자세히 풀어놓은 글처럼 문단을 나눈다.
- ㅇㅇ, ㅋㅋ, ㅋㅋㅋ, ??, ㄱㅊ?, 추천좀, 어떰? 같은 표현을 문맥에 맞을 때만 쓴다.
- 줄임말은 ㅇㅇ, ㅋㅋ, ㅋㅋㅋ, ㄱㅊ, ㄹㅇ, 추천좀, 어떰 정도만 쓴다. 알아볼 수 없는 초성이나 새 줄임말을 만들지 않는다.
- `:)`, `ㅠ`, `ㅜ`, `ㅎㅎ`, 마침표는 쓰지 않는다. 웃음은 ㅋㅋ 또는 ㅋㅋㅋ만 쓴다.
- 존댓말로 정리된 상담글이나 블로그 문체는 금지한다.
- 맞춤법을 일부러 망가뜨리지는 말되 너무 반듯하게 다듬지 않는다.
- `혹시 ~인가요?`, `여러분들은 어떠세요?`, `~하면 좋을 것 같아요` 같은 설문·상담문 말투를 반복하지 않는다.
- 실제 사람이 폰으로 바로 쓴 것처럼 군더더기 없이 쓴다. 상황과 관계없는 설정을 억지로 붙이지 않는다.
- 모든 글을 질문으로 끝내지 않는다. 특히 review는 느낀 점이나 소감으로 자연스럽게 끝낸다.
- `~습니다`, `~해요`, `~인가요` 같은 존댓말 문체를 쓰지 않고 반말·혼잣말로 쓴다.
- companion에는 소재에 없는 나이·성별·지역·직업·브랜드명·행사명·매장명을 절대 만들어 넣지 않는다.
- 제목과 본문 끝맺음·문장 구조를 글마다 다르게 한다.
- 실제 업체나 개인을 비방하거나 사실인 것처럼 지어내지 않는다.
- 연락처, 실명, 성적·불법 내용, 광고는 쓰지 않는다.
- 기존 샘플과 같은 사건·제목을 다시 쓰지 않는다.
- 오늘·내일·어제·지금·방금·요일·주말·평일·아침·점심·퇴근·저녁·밤·새벽처럼 게시 시각에 따라 어색해지는 표현은 쓰지 않는다.
- 비·눈·날씨·기온·더위·추위·계절처럼 실제 날씨와 어긋날 수 있는 표현은 쓰지 않는다.
- review는 소개팅·로소·로테이션 소개팅·소셜링·혼술바·매칭·애프터·친구 소개를 실제로 이용하거나 겪은 후기만 쓴다.

[승인된 톤 예시]
제목: 소개팅 잘되면 여자쪽에서 먼저 2차 말해도 ㄱㅊ?
내용: 소개팅 상대랑 연락할때 느낌은 괜찮거든??\n\n카페에서 얘기 잘통하면 내가 먼저 밥먹자고 해볼까 하는데\n너무 맘에들어하는 티나는건가 ㅋㅋ\n\n남자들 입장에서 여자가 먼저 2차가자하면 어떰?\n걍 배 안고프냐고 물어보면 되나 ㅋㅋ

[후기 톤 예시]
제목: 로소 혼자 갔다온 후기
내용: 처음 가봤는데 생각보다 안어색했음 ㅋㅋ\n\n초반엔 좀 뚝뚝했는데 몇 번 얘기하니 적응되더라\n혼자 갈까말까 고민했는데 가길 잘한듯

서로 겹치지 않는 새 글을 JSON으로 반환해라."""


def _call_cloudflare_ai(token: str, samples: list[dict[str, str]], requests: list[tuple[str, str]]) -> list[Draft]:
    count = len(requests)
    schema = {
        'type': 'object',
        'properties': {
            'posts': {
                'type': 'array',
                'minItems': count,
                'maxItems': count,
                'items': {
                    'type': 'object',
                    'properties': {
                        'title': {'type': 'string', 'minLength': 1, 'maxLength': 60},
                        'content': {'type': 'string', 'minLength': 1, 'maxLength': 1200},
                        'topic': {'type': 'string', 'enum': TOPICS},
                        'kind': {'type': 'string', 'enum': POST_KINDS},
                    },
                    'required': ['title', 'content', 'topic', 'kind'],
                },
            }
        },
        'required': ['posts'],
    }
    payload = {
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': _prompt(samples, requests)},
        ],
        'temperature': 0.75,
        'max_tokens': 5000,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'auto_board_posts', 'schema': schema, 'strict': True},
        },
    }
    response = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = httpx.post(
                CF_AI_URL,
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                json=payload,
                timeout=90,
            )
            response.raise_for_status()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1 + attempt * 2)
    if response is None or response.is_error:
        raise RuntimeError(f'Workers AI 호출 실패: {last_error}')
    body = response.json()
    if not body.get('success'):
        raise RuntimeError(f"Workers AI 실패: {body.get('errors')}")
    result = body.get('result') or {}
    raw = result.get('response') if isinstance(result, dict) else result
    # GPT-OSS 등 최신 모델은 Chat Completions 형태로 응답한다.
    if isinstance(result, dict) and result.get('choices'):
        raw = ((result['choices'][0].get('message') or {}).get('content'))
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    return [Draft(str(x['title']).strip(), str(x['content']).strip(), str(x['topic']).strip(), str(x['kind']).strip())
            for x in (parsed or {}).get('posts', [])]


def _valid(draft: Draft, seen: set[str]) -> bool:
    title_key = _key(draft.title)
    merged = f'{draft.title} {draft.content}'.lower().replace(' ', '')
    if not title_key or title_key in seen:
        return False
    if draft.kind not in POST_KINDS:
        return False
    if not (1 <= len(draft.title) <= 60 and 1 <= len(draft.content) <= 10_000):
        return False
    if any(word in merged for word in BANNED):
        return False
    if any(label in merged for label in KIND_LABELS.values()):
        return False
    if re.search(r'(:\)|[ㅠㅜ]|ㅎ{2,}|[.]|ㅋ{4,})', f'{draft.title}\n{draft.content}'):
        return False
    if re.search(
        r'(오늘|내일|어제|지금|방금|이번\s*주|주말|평일|월요일|화요일|수요일|목요일|금요일|토요일|일요일|아침|오전|점심|퇴근|저녁|밤|새벽|비\s*오|비가|비와|눈\s*오|눈이|눈와|날씨|기온|더위|추위|밤공기|계절|시간째)',
        f'{draft.title}\n{draft.content}',
    ):
        return False
    if re.search(r'\d{1,2}\s*시(?:에|쯤|부터|까지|\s|,|\?|!|$)', f'{draft.title}\n{draft.content}'):
        return False
    if re.search(
        r'(습니다|입니다|합니다|됩니다|구합니다|했어요|해요|있어요|없어요|같아요|더라구요|라고요|인가요|있나요|없나요|가나요|되나요|될까요|할까요|어떠세요|줄래요|구해요)',
        f'{draft.title}\n{draft.content}',
    ):
        return False
    if re.search(r'요[?!.~]*(?:\s*[ㅋㅎㅠㅜ]+)?(?:\s|$)', f'{draft.title}\n{draft.content}'):
        return False
    if re.search(r'(?<!\d)1[4-9]\d(?!\d)', merged):
        return False
    if draft.kind == 'review':
        if len(draft.content) < 35:
            return False
        if '?' in draft.content:
            return False
        if re.search(r'(만나러|갈예정|가는데|어떨지|모르겠|고민중)', merged):
            return False
        if not re.search(
            r'(다녀왔|가봤|갔다|갔어|갔음|만나봤|만났다|만났어|만났음|해봤|했더니|했는데|했어|했음|봤더니|봤는데|봤어|봤음|였는데|였어|였음|었는데|았는데|더라|좋았|괜찮았|편했|재밌었|나눠냈|챙겼)',
            draft.content.replace(' ', ''),
        ):
            return False
        if not re.search(
            r'(소개팅|로소|로테이션|소셜링|혼술바|매칭|애프터|친구소개)',
            merged,
        ):
            return False
    if draft.kind == 'companion':
        # 소재에 없는 나이·성별·구체 지역을 만들어 넣은 결과는 버린다.
        if re.search(r'(\d{2}대|\d{2}살|남성|여성|남자|여자|강남|홍대|신촌|성수|건대|잠실)', merged):
            return False
    # 모델이 가끔 한글 대신 일본어·중국어 또는 의미 없는 초성을 섞는다.
    if re.search(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]', merged):
        return False
    for run in re.findall(r'[ㄱ-ㅎㅏ-ㅣ]{3,}', merged):
        if run != 'ㅋㅋㅋ':
            return False
    # 전화번호·이메일·카카오 오픈채팅 주소는 초안 단계에서 바로 버린다.
    if re.search(r'01[016789][-. ]?\d{3,4}[-. ]?\d{4}', merged):
        return False
    if re.search(r'[\w.+-]+@[\w.-]+\.[a-z]{2,}', merged, re.I):
        return False
    if 'open.kakao.com' in merged:
        return False
    return True


def _automatic_nickname() -> str:
    return f'{random.choice(AUTO_NICK_ADJ)}{random.choice(AUTO_NICK_NOUN)}{random.randint(10, 99)}'


def _nicknames(count: int) -> list[str]:
    """앱 자동 배정형과 짧은 익명형을 가까이 1:1로 섞는다."""
    automatic_count = count // 2
    casual_count = count - automatic_count

    automatic: list[str] = []
    while len(automatic) < automatic_count:
        nickname = _automatic_nickname()
        if nickname not in automatic:
            automatic.append(nickname)

    casual: list[str] = []
    pool = CASUAL_NICKNAMES[:]
    while len(casual) < casual_count:
        random.shuffle(pool)
        for nickname in pool:
            if casual.count(nickname) < 2:
                casual.append(nickname)
                if len(casual) == casual_count:
                    break

    out = automatic + casual
    random.shuffle(out)
    for i in range(1, len(out)):
        if out[i] != out[i - 1]:
            continue
        swap = next((j for j in range(i + 1, len(out)) if out[j] != out[i]), None)
        if swap is not None:
            out[i], out[swap] = out[swap], out[i]
    return out


def _avatars(count: int) -> list[str]:
    """24종을 고르게 섞고 같은 이미지가 연속해 나오지 않게 한다."""
    out: list[str] = []
    while len(out) < count:
        pool = AVATAR_IDS[:]
        random.shuffle(pool)
        if out and pool[0] == out[-1]:
            pool[0], pool[1] = pool[1], pool[0]
        out.extend(pool[:count - len(out)])
    return out


def _active_tag_ids(sb) -> dict[str, str]:
    rows = (
        sb.table('board_tags')
        .select('id,label')
        .eq('is_active', True)
        .execute().data or []
    )
    return {str(row.get('label') or '').strip('[] '): str(row['id']) for row in rows}


def _tag_ids_for_drafts(drafts: list[Draft], tag_ids: dict[str, str]) -> list[str | None]:
    """내용에 맞는 말머리도 소수만 붙이고, 한 묶음의 25%를 넘지 않는다."""
    selected: list[int] = []
    for index, draft in enumerate(drafts):
        label = KIND_LABELS.get(draft.kind)
        if label and tag_ids.get(label) and random.random() < TAG_PROBABILITIES[draft.kind]:
            selected.append(index)

    max_tagged = max(1, (len(drafts) + 3) // 4) if drafts else 0
    if len(selected) > max_tagged:
        selected = random.sample(selected, max_tagged)
    selected_set = set(selected)
    return [
        tag_ids.get(KIND_LABELS.get(draft.kind, '')) if index in selected_set else None
        for index, draft in enumerate(drafts)
    ]


def _long_form_positions(kinds: list[str]) -> set[int]:
    """약 다섯 건마다 한 건을 긴 글로 고르되 서로 붙지 않게 흩어 놓는다."""
    target = len(kinds) // 5
    if target == 0:
        return set()
    candidates = [i for i, kind in enumerate(kinds) if kind in LOCAL_LONG_CASES]
    random.shuffle(candidates)
    selected: list[int] = []
    for index in candidates:
        if any(abs(index - chosen) < 3 for chosen in selected):
            continue
        selected.append(index)
        if len(selected) == target:
            break
    if len(selected) < target:
        for index in candidates:
            if index not in selected:
                selected.append(index)
                if len(selected) == target:
                    break
    return set(selected)


def _local_title(kind: str, base: str) -> str:
    if kind in {'review', 'companion'}:
        return random.choice(LOCAL_TITLE_WRAPPERS[kind]).format(base=base)
    if kind == 'advice':
        return random.choice([
            base,
            f'{base} 이거 어케함?',
            f'{base} 조언좀',
            f'{base} 고민중',
            f'이거 좀 봐줘 {base}',
        ])
    if kind == 'question':
        return random.choice([
            base,
            f'다들 {base}',
            f'이거 궁금한데 {base}',
            f'경험자들 {base}',
            f'{base} 궁금',
        ])
    return random.choice([
        base,
        f'다들 {base}',
        f'갑자기 궁금한데 {base}',
        f'이거 은근 궁금함 {base}',
        f'{base} 은근 궁금함',
    ])


def _local_draft(kind: str, long_form: bool = False) -> Draft:
    if long_form and kind in LOCAL_LONG_CASES:
        long_case = random.choice(LOCAL_LONG_CASES[kind])
        if kind == 'casual':
            titles, content = long_case
            topic = '2030일상'
        else:
            titles, content, topic = long_case
        base = random.choice(titles)
        return Draft(
            title=_local_title(kind, base),
            content=content,
            topic=topic,
            kind=kind,
            scenario=titles[0],
            is_long=True,
        )
    if kind == 'review':
        titles, first, second, third, topic = random.choice(LOCAL_REVIEW_CASES)
        base = random.choice(titles)
        title = _local_title(kind, base)
        content = f'{first}\n\n{second}\n{third}'
    elif kind == 'advice':
        titles, setup, question, topic = random.choice(LOCAL_ADVICE_CASES)
        base = random.choice(titles)
        title = _local_title(kind, base)
        bridge = random.choice([
            '좀 애매해서 고민중',
            '나만 신경쓰는 건지 모르겠음',
            '괜히 혼자 의미부여하는 건가 싶어',
            '이대로 두는 게 맞나 싶음',
        ])
        content = f'{setup}\n\n{bridge}\n{question}'
    elif kind == 'question':
        titles, question, topic = random.choice(LOCAL_QUESTION_CASES)
        base = random.choice(titles)
        title = _local_title(kind, base)
        lead = random.choice([
            '갑자기 궁금한데',
            '사람마다 다르긴 하겠지만',
            '이거 은근 갈리는 것 같아서',
            '경험 있는 사람들 기준으로',
        ])
        content = f'{lead}\n{question}'
    elif kind == 'casual':
        titles, first, second = random.choice(LOCAL_CASUAL_CASES)
        base = random.choice(titles)
        title = _local_title(kind, base)
        tail = random.choice([
            '',
            '\n이런거 은근 취향 갈리더라',
            '\n나만 그런 건지 궁금함 ㅋㅋ',
        ])
        content = f'{first}\n\n{second}{tail}'
        topic = '2030일상'
    else:
        titles, first, second = random.choice(LOCAL_COMPANION_CASES)
        base = random.choice(titles)
        title = _local_title(kind, base)
        content = f'{first}\n\n{second}'
        topic = '로테이션소개팅' if ('로소' in base or '소셜링' in base or '로테이션' in base) else '2030일상'
    return Draft(title=title, content=content, topic=topic, kind=kind, scenario=titles[0])


def _local_drafts(kinds: list[str], seen: set[str]) -> list[Draft]:
    drafts: list[Draft] = []
    requested = Counter(kinds)
    case_counts = {
        'review': len(LOCAL_REVIEW_CASES),
        'advice': len(LOCAL_ADVICE_CASES),
        'question': len(LOCAL_QUESTION_CASES),
        'casual': len(LOCAL_CASUAL_CASES),
        'companion': len(LOCAL_COMPANION_CASES),
    }
    scenario_counts: Counter[str] = Counter()
    recent_scenarios: list[str] = []
    long_positions = _long_form_positions(kinds)
    for position, kind in enumerate(kinds):
        max_per_scenario = (requested[kind] + case_counts[kind] - 1) // case_counts[kind]
        for _ in range(500):
            draft = _local_draft(kind, position in long_positions)
            if scenario_counts[draft.scenario] >= max_per_scenario:
                continue
            if draft.scenario in recent_scenarios[-6:]:
                continue
            if _valid(draft, seen):
                drafts.append(draft)
                seen.add(_key(draft.title))
                scenario_counts[draft.scenario] += 1
                recent_scenarios.append(draft.scenario)
                break
        else:
            raise RuntimeError(f'로컬 조합에서 중복되지 않는 {kind} 글을 만들지 못했습니다')
    return drafts


def generate_local(count: int, dry_run: bool = False) -> list[dict]:
    """검수된 문장 조합만 사용해 외부 AI 호출 없이 자동 게시 후보를 만든다."""
    sb = get_supabase()
    seen = _existing_auto_titles(sb)
    tag_ids = _active_tag_ids(sb)
    drafts = _local_drafts(_kind_targets(count), seen)
    assigned_tag_ids = _tag_ids_for_drafts(drafts, tag_ids)

    rows = []
    for nick, avatar_id, draft, tag_id in zip(
        _nicknames(len(drafts)), _avatars(len(drafts)), drafts, assigned_tag_ids,
    ):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar_id,
            'tag_id': tag_id,
            'source_type': 'original',
            'status': 'ready',
            'generation_model': 'local-template-v2',
            'generation_notes': f'토큰 없는 로컬 조합 · {draft.kind} · {"긴 글" if draft.is_long else "일반 글"} · 주제 {draft.topic} · 소재 {draft.scenario}',
        })

    if dry_run:
        return rows
    result = sb.table('auto_board_posts').insert(rows).execute()
    saved = result.data or []
    if len(saved) != len(rows):
        raise RuntimeError(f'초안 저장 건수 불일치({len(saved)}/{len(rows)})')
    return saved


def generate_cloudflare(count: int, dry_run: bool = False) -> list[dict]:
    """오너가 수동으로 선택했을 때만 사용하는 AI 비상 생성 경로."""
    token = os.getenv('CF_WORKERS_AI_TOKEN')
    if not token:
        raise RuntimeError('CF_WORKERS_AI_TOKEN이 없습니다')
    sb = get_supabase()
    samples = _recent_samples(sb)
    if len(samples) < 10:
        raise RuntimeError(f'말투 참고용 기존 게시글이 부족합니다({len(samples)}건)')
    seen = {_key(s['title']) for s in samples} | _existing_auto_titles(sb)
    tag_ids = _active_tag_ids(sb)

    drafts: list[Draft] = []
    pending_requests = _generation_requests(_kind_targets(count))
    # 한 번에 너무 많이 시키면 말투가 반복되므로 세 건씩 나눠 만든다.
    attempts = 0
    max_attempts = max(5, count * 3)
    while pending_requests and attempts < max_attempts:
        attempts += 1
        requests = pending_requests[:3]
        generated = _call_cloudflare_ai(token, random.sample(samples, min(24, len(samples))), requests)
        retry_requests: list[tuple[str, str]] = []
        for index, (kind, scenario) in enumerate(requests):
            draft = generated[index] if index < len(generated) else None
            if draft is not None and draft.kind == kind and _valid(draft, seen):
                draft.scenario = scenario
                drafts.append(draft)
                seen.add(_key(draft.title))
            else:
                retry_requests.append((kind, scenario))
        pending_requests = retry_requests + pending_requests[len(requests):]
        if not generated:
            break

    if not drafts:
        raise RuntimeError(f'검증을 통과한 초안이 없습니다(0/{count})')
    if len(drafts) < count:
        # 좋지 않은 글을 얇은 기준으로 억지 통과시키지 않는다. 이번에 통과한
        # 글만 저장하면 다음 실행이 남은 부족분을 다시 채운다.
        print(f'주의: 품질 검증 통과 {len(drafts)}/{count}건 — 통과한 초안만 저장합니다')

    rows = []
    saved_count = len(drafts)
    assigned_tag_ids = _tag_ids_for_drafts(drafts, tag_ids)
    for nick, avatar_id, draft, tag_id in zip(
        _nicknames(saved_count), _avatars(saved_count), drafts, assigned_tag_ids,
    ):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar_id,
            'tag_id': tag_id,
            'source_type': 'existing_posts',
            'status': 'ready',
            'generation_model': f'{CF_AI_PROVIDER}:{CF_MODEL}',
            'generation_notes': f'기존 활성 게시글 {len(samples)}건의 말투 참고 · {draft.kind} · 주제 {draft.topic} · 소재 {draft.scenario}',
        })

    if dry_run:
        return rows
    result = sb.table('auto_board_posts').insert(rows).execute()
    saved = result.data or []
    if len(saved) != len(rows):
        raise RuntimeError(f'초안 저장 건수 불일치({len(saved)}/{len(rows)})')
    return saved


def open_queue_count() -> int:
    sb = get_supabase()
    rows = (
        sb.table('auto_board_posts')
        .select('id')
        .in_('status', ['ready', 'scheduled'])
        .limit(100)
        .execute().data or []
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=12)
    parser.add_argument('--generator', choices=['local', 'cloudflare'], default='local',
                        help='기본 local은 토큰을 쓰지 않으며 AI 생성은 Cloudflare Workers AI만 사용합니다')
    parser.add_argument('--fill-to', type=int, default=0,
                        help='미게시 대기 글이 이 개수가 되도록 부족분만 생성')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.fill_to:
        if not 1 <= args.fill_to <= 100:
            raise SystemExit('--fill-to는 1~100이어야 합니다')
        current = open_queue_count()
        args.count = max(0, args.fill_to - current)
        if args.count == 0:
            print(f'미게시 대기 글 {current}건 — 추가 생성 없음')
            return
    if not 1 <= args.count <= 100:
        raise SystemExit('--count는 1~100이어야 합니다')
    rows = (generate_local(args.count, args.dry_run)
            if args.generator == 'local'
            else generate_cloudflare(args.count, args.dry_run))
    print(f"{'생성 확인' if args.dry_run else '초안 저장'}: {len(rows)}건")
    for row in rows:
        print(f"- [{row['nickname']}] {row['title']}")


if __name__ == '__main__':
    main()
