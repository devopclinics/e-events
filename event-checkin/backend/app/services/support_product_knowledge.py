"""Reviewed product guidance, versioned with the application; no customer records."""
VERSION='2026-11-04'
def product_answer(text):
    text=text.lower()
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
