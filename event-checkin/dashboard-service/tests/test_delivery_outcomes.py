from app.delivery_reporting import build_delivery_report

def row(i,status,reason='invite',test=False):return (i,'whatsapp','reserve',status,i,reason,test)
def email(i,status,kind,test=False):return (i,None,i,status,None,kind,test)

def test_sent_is_pending_failure_is_never_delivered_and_reads_confirm_delivery():
    r=build_delivery_report([row('a','sent'),row('b','undelivered'),row('c','delivery_failed'),row('d','read'),row('e','mystery')],[])
    assert r['whatsapp']=={'sent':5,'delivered':1,'failed':2,'pending':1,'unknown':1,'rate':20}

def test_test_metadata_and_test_guests_are_excluded_after_deduplication():
    r=build_delivery_report([row('a','delivered','reminder:test'),row('b','delivered','invite',True),row('c','delivered','reminder:live')],[email('e','delivered',None),email('e','sent','reminder_test'),email('f','delivered','experience_invitation')])
    assert r['excluded_tests']=={'email':1,'sms':0,'whatsapp':2,'mms':0}
    assert r['overall']['sent']==2 and r['overall']['delivered']==2
    assert {t['key']for t in r['by_type']}=={'invitations','reminders'}

def test_weighted_rate_and_message_type_breakdowns():
    r=build_delivery_report([row('a','delivered','session_checkin:conference')],[email(str(i),'failed' if i else 'delivered','reminder-live')for i in range(9)])
    assert r['overall']['rate']==20  # 2 of 10, not average(100%,11%)
    assert {t['key']for t in r['by_type']}=={'reminders','check_in_receipts'}

def test_refund_wins_and_unclassified_messages_remain_visible():
    rows=[row('a','delivered','message'),('refund','whatsapp','refund','refunded','a','message',False)]
    r=build_delivery_report(rows,[])
    assert r['whatsapp']['sent']==1 and r['whatsapp']['failed']==1 and r['whatsapp']['delivered']==0
    assert r['by_type'][0]['key']=='other'


def test_orphan_refund_is_not_an_additional_message_attempt():
    r=build_delivery_report([('refund','whatsapp','refund','refunded',None,'refund',False)],[])
    assert r['overall']['sent']==0
