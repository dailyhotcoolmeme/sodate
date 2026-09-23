"""모잇 커뮤니티 자동 글 초안 생성기.

기존 게시판의 실제 말투를 참고해 자동 게시 후보를 만들고 auto_board_posts에 저장한다.
이 스크립트는 board_posts에 직접 쓰지 않는다. 공개는 예약 게시 작업만 수행한다.

실행:
  python auto_board_posts.py --count 12                 # 토큰 없는 로컬 조합 생성
  python auto_board_posts.py --count 3 --dry-run
  python auto_board_posts.py --generator ai --count 3  # 수동 비상용 AI 생성
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
- review: 질문이 아니라 자신이 겪은 일을 자연스럽게 풀어쓴 후기. 시스템이 [리얼후기] 말머리를 별도로 붙인다. 끝을 굳이 질문으로 마치지 않는다.
- advice: 상황을 풀어놓고 조언을 구하는 글. 시스템이 [고민상담] 말머리를 별도로 붙인다.
- question: 가벼운 궁금증을 묻는 글. 시스템이 [궁금해요] 말머리를 별도로 붙인다.
- companion: 같이 갈 사람을 구하는 글. 시스템이 [동행구함] 말머리를 별도로 붙인다. 연락처는 적지 않는다.
- casual: 일상 잡담. 말머리를 붙이지 않는다.
- 제목과 본문에 [리얼후기], [고민상담] 같은 말머리 문자를 직접 적지 않는다.

[반드시 지킬 말투]
- 짧게 끊고 말하듯 쓴다. 2~6문장이 기본이며 한두 줄짜리 글도 섞는다.
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


def _call_ai(token: str, samples: list[dict[str, str]], requests: list[tuple[str, str]]) -> list[Draft]:
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


def _local_draft(kind: str) -> Draft:
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
    for kind in kinds:
        max_per_scenario = (requested[kind] + case_counts[kind] - 1) // case_counts[kind]
        for _ in range(500):
            draft = _local_draft(kind)
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

    rows = []
    for nick, avatar_id, draft in zip(_nicknames(len(drafts)), _avatars(len(drafts)), drafts):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar_id,
            'tag_id': tag_ids.get(KIND_LABELS.get(draft.kind, '')),
            'source_type': 'original',
            'status': 'ready',
            'generation_model': 'local-template-v1',
            'generation_notes': f'토큰 없는 로컬 조합 · {draft.kind} · 주제 {draft.topic} · 소재 {draft.scenario}',
        })

    if dry_run:
        return rows
    result = sb.table('auto_board_posts').insert(rows).execute()
    saved = result.data or []
    if len(saved) != len(rows):
        raise RuntimeError(f'초안 저장 건수 불일치({len(saved)}/{len(rows)})')
    return saved


def generate_ai(count: int, dry_run: bool = False) -> list[dict]:
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
        generated = _call_ai(token, random.sample(samples, min(24, len(samples))), requests)
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
    for nick, avatar_id, draft in zip(_nicknames(saved_count), _avatars(saved_count), drafts):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar_id,
            'tag_id': tag_ids.get(KIND_LABELS.get(draft.kind, '')),
            'source_type': 'existing_posts',
            'status': 'ready',
            'generation_model': CF_MODEL,
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
    parser.add_argument('--generator', choices=['local', 'ai'], default='local',
                        help='기본 local은 외부 AI 호출과 토큰 사용이 없습니다')
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
    rows = generate_local(args.count, args.dry_run) if args.generator == 'local' else generate_ai(args.count, args.dry_run)
    print(f"{'생성 확인' if args.dry_run else '초안 저장'}: {len(rows)}건")
    for row in rows:
        print(f"- [{row['nickname']}] {row['title']}")


if __name__ == '__main__':
    main()
