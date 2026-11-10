"""Reviewed product guidance, versioned with the application; no customer records."""
VERSION='2026-11-10'
def _quick_answer(text):
    import re
    text=' '.join(text.lower().split())
    text=re.sub(r'\b(?:servcies|servcices|servces)\b', 'services', text)
    if (re.search(r'\b(?:services?|features?|capabilities|tools)\b',text)
        and re.search(r'\b(?:festio|you|your)\b',text)
        and re.search(r'\b(?:what|which|list|offer|offered|provide|available|tell|show)\b',text)):
        return ('Festio helps you create, share and run events. Available tools include:\n\n'
                '• Invitations and RSVPs — design invitations and collect guest replies.\n'
                '• Guest lists, tickets and registration — organise attendees and issue passes.\n'
                '• QR check-in and session access — record arrivals and control session entry.\n'
                '• Tables and seating — create tables, set capacities and assign guests.\n'
                '• Planner — organise tasks, budgets, vendors and the event runsheet.\n'
                '• Menu management — collect meal choices and manage meal service.\n'
                '• Messaging and reminders — communicate using enabled guest channels.\n'
                '• Conference tools — manage speakers, sessions and programmes.\n'
                '• Festio Live — run polls, questions and live activities.\n'
                '• Registry and donations — share gift lists and fundraising options.\n'
                '• Event websites and GuestHub — share event information and guest resources.\n'
                '• FestioMe — support event community and networking.\n\n'
                'Features, limits and charges depend on your event setup and access.\n'
                'Start here: /setup-redesign?view=wizard\nBrowse Help: /guide.html\n\n'
                'Which part of your event would you like help with?')
    if any(w in text for w in ['what is festio','what’s festio','what does festio','guesthub','festio live','festiome']):
        return ('Festio helps you create, share and run events.\n\nGuestHub is the guest-facing place for an event’s programme, updates and personal pass when available.\n\nFestio Live is for live participation, such as polls, questions and activities.\n\nFestioMe provides event community and networking spaces. Features depend on what the organiser enables.\n\nAre you organising an event, or attending one?')
    if any(w in text for w in ['seating','seat guests','arrange tables','seats per table','floor plan']):
        return ('To arrange seating:\n1. Create or select your event.\n2. Add or import your guests.\n3. Open Seating, create tables and set seats per table.\n4. Assign guests, then arrange tables in the floor plan.\n\nStart with Setup Guide: /setup-redesign?view=wizard\nChoose “Arrange tables & seating”. Seating access may need to be enabled for your event. Do you already have an event?')
    if any(w in text for w in ['create an event','create event','start an event','set up an event','setup guide']):
        return ('Open Setup Guide and choose what you need first: invitations, tickets, check-in, seating, a conference or donations. Enter your event details, then continue to the selected tool. You can combine more tools later.\n\nOpen Setup Guide: /setup-redesign?view=wizard\nFor a simple invitation and RSVPs: /create-invitation\n\nWhat would you like to set up first?')
    if any(w in text for w in ['qr check-in','check guests in','qr scanning']):
        return ('For QR check-in, create or select your event, add/import guests and prepare their passes. Your team can then use the scanner to check arrivals.\n\nStart in Setup Guide: /setup-redesign?view=wizard\nChoose “Check guests in”. Do you already have a guest list?')
    if any(w in text for w in ['send invitations','collect rsvp','free invitation']):
        return ('Create an invitation, add your event details, preview the design and share its link. Guests can reply without creating an account. Email sending and other tools may have separate limits or access requirements.\n\nCreate an invitation: /create-invitation')
    return None


def product_answer(text):
    from .support_help import find_help,article_answer
    quick=_quick_answer(text)
    topic=find_help(text)
    if quick:return quick+('\n\nFrom Help: '+topic['title']+'\n'+topic['url'] if topic else '')
    return article_answer(topic) if topic else None
