"""Deterministic retrieval from the same public Help topics as /guide.html."""
import json,re
from pathlib import Path
CATALOG=json.loads(Path(__file__).with_name('support_help_catalog.json').read_text())
ALIASES={
 'org-create':['create event','create an event','new event','start an event'],
 'org-seating':['seating','arrange tables','seat guests','seats per table','table capacity'],
 'org-planner':['planner','budget','vendors','runsheet'],
 'org-team':['invite team','team members','invite staff'],
 'org-ticketing':['sell tickets','ticketing','ticket sales'],
 'org-guests':['import guests','guest list','add guests'],
 'org-meals':['menu management','meal selection','food menu'],
}
STOP=set('how do i a an the is to for and with on of my can what please help me our it use want need'.split())
def words(text):return {w[:-1] if len(w)>4 and w.endswith('s') else w for w in re.findall(r'[a-z0-9]+',text.lower()) if w not in STOP}
def find_help(text):
 text=' '.join(text.lower().split());byid={t['id']:t for t in CATALOG['topics']}
 for ident,terms in ALIASES.items():
  if any(term in text for term in terms) and ident in byid:return byid[ident]
 if not re.search(r'\b(how|help|setup|configure|manage|enable|import|export|use)\b',text):return None
 query=words(text)
 if not query:return None
 ranked=[]
 for t in CATALOG['topics']:
  title=words(t['title']);overlap=(query&title)-{'event','guest','festio','create','start'}
  score=len(overlap)*4+len(query&words(t['intro']))
  if overlap and score>=5:ranked.append((score,t))
 ranked.sort(key=lambda x:x[0],reverse=True)
 if not ranked or len(ranked)>1 and ranked[0][0]==ranked[1][0]:return None
 return ranked[0][1]
def article_answer(topic):
 steps='\n'.join(str(i+1)+'. '+s for i,s in enumerate(topic['steps'][:4]))
 return topic['title']+'\n\n'+topic['intro']+('\n\n'+steps if steps else '')+'\n\nRead the full Help article: '+topic['url']
